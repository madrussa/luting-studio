// Macro compression for lutings ("thorough" style): expand any existing
// macros, then repeatedly extract the repeated token sequence with the best
// character savings into an A{...} macro, with repeat counts (A4) on top.
//
// Macros are textual, so replacing identical token sequences can never change
// the sound — provided we don't split a token (o4, g'4, r12, (ceg)2 ...) or
// cross a voice boundary. A final self-check parses both versions and compares
// the full note schedules before accepting the result.

import { parseLuting, expandMacros } from './luting'
import type { ParseResult } from './luting'

export interface OptimizeResult {
  output: string
  before: number
  after: number
  macrosUsed: number
  warnings: string[]
}

const NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'

/** Split a voice body into atomic tokens that must never be cut apart. */
function tokenize(src: string, warnings: string[]): string[] | null {
  const tokens: string[] = []
  let i = 0
  const readFraction = (): string => {
    let s = ''
    while (isDigit(src[i])) s += src[i++]
    if (src[i] === '/') {
      s += '/'
      i++
      while (isDigit(src[i])) s += src[i++]
    }
    return s
  }
  while (i < src.length) {
    const c = src[i]
    if (c === '|' || c === '~' || c === '>' || c === '<') {
      tokens.push(c)
      i++
    } else if (c === 'i') {
      tokens.push(src.slice(i, i + 2))
      i += 2
    } else if (c === 'o') {
      i++
      tokens.push(isDigit(src[i]) ? 'o' + src[i++] : 'o')
    } else if (c === 'v' || c === 's') {
      i++
      tokens.push(src[i] >= '1' && src[i] <= '9' ? c + src[i++] : c)
    } else if (c === 't' || c === 'r') {
      i++
      tokens.push(c + readFraction())
    } else if (c === '@') {
      i++
      let d = ''
      while (isDigit(src[i])) d += src[i++]
      tokens.push('@' + d)
    } else if (c >= 'a' && c <= 'g') {
      i++
      let t = c
      if (src[i] === "'") {
        t += "'"
        i++
      }
      tokens.push(t + readFraction())
    } else if (c === '(') {
      const j = src.indexOf(')', i)
      if (j === -1) return null
      let t = src.slice(i, j + 1)
      i = j + 1
      tokens.push(t + readFraction())
    } else {
      warnings.push(`Unexpected character "${c}" kept as-is.`)
      tokens.push(c)
      i++
    }
  }
  return tokens
}

interface Candidate {
  positions: number[]
  len: number
  gain: number
}

/**
 * Find the repeated token sequence with the highest character saving.
 * Saving for k non-overlapping occurrences of a sequence L chars long:
 * k*L before; (L+3) for the definition + (k-1) refs after => (k-1)(L-1) - 3.
 */
function findBest(tokens: string[]): Candidate | null {
  const n = tokens.length
  if (n < 2) return null

  const intern = new Map<string, number>()
  const ids = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    let id = intern.get(tokens[i])
    if (id === undefined) {
      id = intern.size + 1
      intern.set(tokens[i], id)
    }
    ids[i] = id
  }

  // a sequence may not cross a voice separator
  const sepNext = new Int32Array(n + 1)
  let next = n
  sepNext[n] = n
  for (let i = n - 1; i >= 0; i--) {
    if (tokens[i] === '|') next = i
    sepNext[i] = next
  }

  const clen = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) clen[i + 1] = clen[i] + tokens[i].length

  // double rolling hash over token ids (values stay < 2^53, exact in floats)
  const M1 = 67108859
  const B1 = 131
  const M2 = 67108837
  const B2 = 137
  const h1 = new Float64Array(n + 1)
  const h2 = new Float64Array(n + 1)
  const p1 = new Float64Array(n + 1)
  const p2 = new Float64Array(n + 1)
  p1[0] = p2[0] = 1
  for (let i = 0; i < n; i++) {
    h1[i + 1] = (h1[i] * B1 + ids[i]) % M1
    h2[i + 1] = (h2[i] * B2 + ids[i]) % M2
    p1[i + 1] = (p1[i] * B1) % M1
    p2[i + 1] = (p2[i] * B2) % M2
  }
  const sub1 = (i: number, len: number) => (h1[i + len] - ((h1[i] * p1[len]) % M1) + M1 * M1) % M1
  const sub2 = (i: number, len: number) => (h2[i + len] - ((h2[i] * p2[len]) % M2) + M2 * M2) % M2

  let best: Candidate | null = null
  const maxLen = Math.min(80, n >> 1)
  for (let len = 1; len <= maxLen; len++) {
    const groups = new Map<number, number[]>()
    for (let i = 0; i + len <= n; i++) {
      if (sepNext[i] < i + len) continue
      const key = sub1(i, len) * M2 + sub2(i, len)
      const g = groups.get(key)
      if (g) {
        if (g.length < 4000) g.push(i)
      } else {
        groups.set(key, [i])
      }
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue
      // guard against hash collisions: keep only true matches of the first
      const base = g[0]
      let eq = g
      for (const p of g) {
        let same = true
        for (let k = 0; k < len; k++) {
          if (ids[p + k] !== ids[base + k]) {
            same = false
            break
          }
        }
        if (!same) {
          eq = g.filter((q) => {
            for (let k = 0; k < len; k++) if (ids[q + k] !== ids[base + k]) return false
            return true
          })
          break
        }
      }
      if (eq.length < 2) continue
      const chosen: number[] = []
      let lastEnd = -1
      for (const p of eq) {
        if (p >= lastEnd) {
          chosen.push(p)
          lastEnd = p + len
        }
      }
      if (chosen.length < 2) continue
      const L = clen[base + len] - clen[base]
      const gain = (chosen.length - 1) * (L - 1) - 3
      if (gain > 0 && (!best || gain > best.gain)) {
        best = { positions: chosen, len, gain }
      }
    }
  }
  return best
}

/** Replace occurrences: first becomes the definition (which also plays), the rest become refs. */
function substitute(tokens: string[], cand: Candidate, name: string): string[] {
  const posSet = new Set(cand.positions)
  const out: string[] = []
  let first = true
  let i = 0
  while (i < tokens.length) {
    if (posSet.has(i)) {
      out.push(first ? `${name}{${tokens.slice(i, i + cand.len).join('')}}` : name)
      first = false
      i += cand.len
    } else {
      out.push(tokens[i])
      i++
    }
  }
  return out
}

/** Join tokens, collapsing runs: A A A -> A3, X{...} X X -> X{...}3. */
function emit(tokens: string[]): string {
  let out = ''
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const isRef = t.length === 1 && t >= 'A' && t <= 'Z'
    const isDef = t.length > 1 && t[0] >= 'A' && t[0] <= 'Z' && t[1] === '{'
    if (isRef || isDef) {
      const name = t[0]
      let j = i + 1
      let count = 1
      while (j < tokens.length && tokens[j] === name) {
        count++
        j++
      }
      out += count > 1 ? `${t}${count}` : t
      i = j
    } else {
      out += t
      i++
    }
  }
  return out
}

function schedulesMatch(a: ParseResult, b: ParseResult): boolean {
  if (a.notes.length !== b.notes.length) return false
  const key = (n: ParseResult['notes'][number]) =>
    `${n.timeSec.toFixed(5)}/${n.instrument}/${n.midi ?? -1}/${n.drum ?? ''}/${n.durSec.toFixed(5)}/${n.volume.toFixed(3)}/${n.pan.toFixed(3)}`
  const sa = a.notes.map(key).sort()
  const sb = b.notes.map(key).sort()
  return sa.every((v, i) => v === sb[i])
}

/**
 * Splits a luting that exceeds the Twitch cheer limit into multilute
 * messages, matching the format produced by the luteboi tools: the first
 * message is the luting's first 491 chars with " m" inserted after "#lute",
 * later messages are "#lute m " + 485 raw chars, and the last drops the "m".
 */
export function toMultilute(luting: string): string[] {
  if (luting.length <= 493) return [luting]
  const parts: string[] = []
  const first = luting.substring(0, 491)
  parts.push(first.slice(0, 5) + ' m' + first.slice(5))
  let i = 491
  while (i < luting.length) {
    const chunk = luting.substring(i, i + 485)
    parts.push(i < luting.length - 485 ? '#lute m ' + chunk : '#lute ' + chunk)
    i += 485
  }
  return parts
}

/**
 * The reverse of optimize: expand every macro back to plain notes (comments
 * and whitespace are stripped too). Unlocks visual editing on macro'd voices.
 */
export function unoptimizeLuting(input: string): OptimizeResult {
  const warnings: string[] = []
  const before = input.length

  let src = input
    .split('//')
    .filter((_, i) => i % 2 === 0)
    .join('')
  let header = ''
  const h = src.match(/#lute\s*(\d+)/)
  if (h) {
    header = `#lute ${h[1]} `
    src = src.replace(h[0], '')
  }
  src = src.replace(/\s+/g, '')

  const defs = new Map<string, string>()
  const output =
    header +
    src
      .split('|')
      .map((v) => expandMacros(v, defs, 0, warnings))
      .join('|')

  if (output === input) {
    return { output: input, before, after: before, macrosUsed: 0, warnings: [...warnings, 'No macros to expand — output unchanged.'] }
  }
  if (!schedulesMatch(parseLuting(input), parseLuting(output))) {
    return { output: input, before, after: before, macrosUsed: 0, warnings: [...warnings, 'Expansion self-check failed; keeping the original.'] }
  }
  return { output, before, after: output.length, macrosUsed: 0, warnings }
}

export function optimizeLuting(input: string): OptimizeResult {
  const warnings: string[] = []
  const before = input.length
  const unchanged = (extra: string): OptimizeResult => ({
    output: input,
    before,
    after: before,
    macrosUsed: 0,
    warnings: [...warnings, extra],
  })

  // strip comments and whitespace, keep the header aside
  let src = input
    .split('//')
    .filter((_, i) => i % 2 === 0)
    .join('')
  let header = ''
  const h = src.match(/#lute\s*(\d+)/)
  if (h) {
    header = `#lute ${h[1]} `
    src = src.replace(h[0], '')
  }
  src = src.replace(/\s+/g, '')

  // expand existing macros so we can re-compress from scratch (defs are
  // shared across voices in textual order, matching luteboi)
  const defs = new Map<string, string>()
  const expanded = src
    .split('|')
    .map((v) => expandMacros(v, defs, 0, warnings))
    .join('|')

  let tokens = tokenize(expanded, warnings)
  if (!tokens) return unchanged('Unbalanced parentheses; could not optimize.')

  let macrosUsed = 0
  while (macrosUsed < NAMES.length) {
    const best = findBest(tokens)
    if (!best) break
    tokens = substitute(tokens, best, NAMES[macrosUsed])
    macrosUsed++
  }

  const optimized = header + emit(tokens)

  if (!schedulesMatch(parseLuting(input), parseLuting(optimized))) {
    return unchanged('Optimizer self-check failed; keeping the original.')
  }
  if (optimized.length >= before) {
    return unchanged('Already as small as the optimizer can make it.')
  }
  return { output: optimized, before, after: optimized.length, macrosUsed, warnings }
}
