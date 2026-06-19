// Macro compression for lutings ("thorough" style): expand any existing
// macros, then repeatedly extract the repeated token sequence with the best
// character savings into an A{...} macro, with repeat counts (A4) on top.
//
// Macros are textual, so replacing identical token sequences can never change
// the sound — provided we don't split a token (o4, g'4, r12, (ceg)2 ...) or
// cross a voice boundary. A final self-check parses both versions and compares
// the full note schedules before accepting the result.

import { parseLuting, expandMacros, reassembleMultilute } from './luting'
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
  /** Voice index if every occurrence is in one voice, else -1 (spans voices). */
  loc: number
}

/**
 * Find the repeated token sequence with the highest character saving, among
 * those whose required macro name is still available (per `canUse`).
 * Saving for k non-overlapping occurrences of a sequence L chars long:
 * k*L before; (L+3) for the definition + (k-1) refs after => (k-1)(L-1) - 3.
 */
function findBest(
  tokens: string[],
  canUse: (loc: number) => boolean,
  localNames: Set<string>,
): Candidate | null {
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

  // a sequence may not contain an instrument directive (ik, iv, …). luteboi
  // resets the instrument per voice, so an instrument lifted into a macro and
  // replayed by a reference elsewhere sets the wrong instrument — or, when the
  // reference is in another voice, none at all (reverting it to the default
  // lute). The original optimiser excludes these in calculateUniqueSubstrings.
  const instrNext = new Int32Array(n + 1)
  let nextInstr = n
  instrNext[n] = n
  for (let i = n - 1; i >= 0; i--) {
    if (tokens[i][0] === 'i') nextInstr = i
    instrNext[i] = nextInstr
  }

  // which voice each token belongs to, so we can tell a within-voice (local)
  // sequence from one whose occurrences span voices (global)
  const voiceId = new Int32Array(n)
  let vc = 0
  for (let i = 0; i < n; i++) {
    voiceId[i] = vc
    if (tokens[i] === '|') vc++
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
      if (instrNext[i] < i + len) continue
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
        // a candidate must contain balanced macro brackets — it may never split
        // a definition (open without close, or close one opened outside it)
        let depth = 0
        let illegal = false
        for (let k = 0; k < len; k++) {
          const tk = tokens[base + k]
          if (tk.endsWith('{')) depth++
          else if (tk === '}') {
            depth--
            if (depth < 0) {
              illegal = true
              break
            }
          }
        }
        if (depth !== 0) illegal = true
        if (illegal) continue

        let loc = voiceId[chosen[0]]
        for (let ci = 1; ci < chosen.length; ci++) {
          if (voiceId[chosen[ci]] !== loc) {
            loc = -1
            break
          }
        }
        // A global macro is expanded eagerly at definition time, so its body
        // must not reference a voice-local macro: that reference would freeze to
        // the defining voice's value and play wrong when the global is reused in
        // another voice. (luteboi's isLocalDef rejects the same case.)
        if (loc < 0) {
          for (let k = 0; k < len; k++) {
            const c0 = tokens[base + k][0]
            if (c0 >= 'A' && c0 <= 'Z' && localNames.has(c0)) {
              loc = -2 // illegal — neither a safe global nor (it spans voices) a local
              break
            }
          }
        }
        if (loc !== -2 && canUse(loc)) best = { positions: chosen, len, gain, loc }
      }
    }
  }
  return best
}

/**
 * First occurrence becomes the definition, with its body kept inline as
 * separate `name{`, …body…, `}` tokens (so later passes can still find and
 * factor repeats *inside* it — this is what enables nested macros). The other
 * occurrences become single-letter reference tokens.
 */
function substitute(tokens: string[], cand: Candidate, name: string): string[] {
  const posSet = new Set(cand.positions)
  const out: string[] = []
  let first = true
  let i = 0
  while (i < tokens.length) {
    if (posSet.has(i)) {
      if (first) {
        out.push(name + '{')
        for (let k = 0; k < cand.len; k++) out.push(tokens[i + k])
        out.push('}')
        first = false
      } else {
        out.push(name)
      }
      i += cand.len
    } else {
      out.push(tokens[i])
      i++
    }
  }
  return out
}

/**
 * Concatenate tokens, folding repeats: refs `A A A` -> `A3`, and a definition
 * immediately followed by its own refs `X{…} X X` -> `X{…}3` (the count rides
 * on the closing `}`, matching how luteboi's parser replays a definition).
 */
function emit(tokens: string[]): string {
  let out = ''
  const stack: string[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const isStart = t.length >= 2 && t.endsWith('{') && t[0] >= 'A' && t[0] <= 'Z'
    const isRef = t.length === 1 && t >= 'A' && t <= 'Z'
    if (isStart) {
      out += t
      stack.push(t[0])
      i++
    } else if (t === '}') {
      const name = stack.pop()
      let j = i + 1
      let count = 1
      while (name !== undefined && j < tokens.length && tokens[j] === name) {
        count++
        j++
      }
      out += count > 1 ? `}${count}` : '}'
      i = j
    } else if (isRef) {
      let j = i + 1
      let count = 1
      while (j < tokens.length && tokens[j] === t) {
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
export function unoptimizeLuting(rawInput: string): OptimizeResult {
  const warnings: string[] = []
  const before = rawInput.length
  // pasted multilutes must be joined before anything else can parse them
  const input = reassembleMultilute(rawInput, warnings)

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

export function optimizeLuting(rawInput: string): OptimizeResult {
  const warnings: string[] = []
  const before = rawInput.length
  // pasted multilutes must be joined before anything else can parse them
  const input = reassembleMultilute(rawInput, warnings)
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

  // Macro names share one 26-letter namespace, but luteboi's parser lets a name
  // be redefined and resolves each reference against the latest definition in
  // textual order. So a name used entirely within one voice (local) can be
  // reused by other voices, while a name whose references span voices (global)
  // must stay unique across the whole song. Mirror the original optimiser:
  // globals draw from Z→A, locals from A→Z per voice, and the pools are kept
  // disjoint by letter so the two never collide. This removes the old hard cap
  // of 26 macros for the entire song (it's now up to ~26 per voice).
  const numVoices = tokens.reduce((c, t) => c + (t === '|' ? 1 : 0), 1)
  const globalPool = NAMES.split('').reverse() // Z, Y, X, … A
  const localPools = Array.from({ length: numVoices }, () => NAMES.split('')) // A … Z
  const drop = (pool: string[], name: string) => {
    const k = pool.indexOf(name)
    if (k !== -1) pool.splice(k, 1)
  }
  const canUse = (loc: number) => (loc < 0 ? globalPool.length > 0 : localPools[loc].length > 0)
  const localNames = new Set<string>()

  let macrosUsed = 0
  for (;;) {
    const best = findBest(tokens, canUse, localNames)
    if (!best) break
    let name: string
    if (best.loc < 0) {
      // global: claim the name everywhere so no voice can redefine it
      name = globalPool[0]
      drop(globalPool, name)
      for (const lp of localPools) drop(lp, name)
    } else {
      // local: claim from this voice and bar it from ever being used globally
      name = localPools[best.loc][0]
      drop(localPools[best.loc], name)
      drop(globalPool, name)
      localNames.add(name)
    }
    tokens = substitute(tokens, best, name)
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
