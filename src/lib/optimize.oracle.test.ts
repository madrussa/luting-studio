import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { optimizeLuting, unoptimizeLuting } from './optimize'

// These tests optimise a handful of songs and verify, against the *real*
// LuteBoi parser, that the optimised luting plays note-for-note identically to
// the original. The optimiser's own self-check uses our TS parser; this guards
// against the two parsers ever disagreeing (which has hidden real bugs before).
//
// Requires a LuteBoi checkout (sibling ../../LuteBoi or $LUTEBOI_DIR) and
// python3. When either is missing the suite skips rather than fails, so it
// stays green for anyone without LuteBoi.

const oracle = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/lute_oracle.py')

// The original instrument-bug report, expanded to plain notes (guards the
// "instrument directive must never end up inside a macro" regression).
const instrumentBug = unoptimizeLuting(
  `#lute 280 ivv6t2r314A{g'gg'(ea)1r3o4(ea)6o4(ea)o4(cg')1r3o4(dg')o4(eg)o4(dg')o4(eg)o4(cg')6o4(ea)6o3(be)6o4}4e<(af)o3(bg)o4(ca)12|ikv6t2D{eb>g'de<bgbeb>g'gagg'd<}4B{eb>ede<bab<(ag')o3(bgb)o4(cac)o3(ag'a)o4eb>ede<bab<(ag')o3(bgb)o4(ae')o4(bg')o4eb>ede<babg'bab(dg')o4(ca)o5deg'<(ed)o5e<bab<(ag')o4(cg)o4}2C{ebabgbebab>d<bebabgbebabgb}4r16>cde4d4c4<b11|ikv6t4r128<G{b>eger8g6g'e1d1cr8eg'r<(be)o3(ad)o3(gc)}r24o3G|I{ikv5}t4r64o1c16b16e24r8>F{e11r1a8e'e11r1c8<b>e11r1c11r1<b11r1>c8d}2<E{ebga>d<b>c<ga>d<ab}4r12f19r1e11|It2r172H{ce'r8<b4r12g'ed6g'(gb)6o3g'}r48>H|It2r204<ba4`,
).output

const SONGS: Record<string, string> = {
  // Large multi-voice piece used throughout development; exercises nested
  // macros, per-voice name reuse, and redundant-octave stripping at once.
  'epic-multivoice':
    "#lute 280 ivv6t2r314g'gg'(ea)1r3o4(ea)6o4(ea)o4(cg')1r3o4(dg')o4(eg)o4(dg')o4(eg)o4(cg')6o4(ea)6o3(be)6o4g'gg'(ea)1r3o4(ea)6o4(ea)o4(cg')1r3o4(dg')o4(eg)o4(dg')o4(eg)o4(cg')6o4(ea)6o3(be)6o4g'gg'(ea)1r3o4(ea)6o4(ea)o4(cg')1r3o4(dg')o4(eg)o4(dg')o4(eg)o4(cg')6o4(ea)6o3(be)6o4g'gg'(ea)1r3o4(ea)6o4(ea)o4(cg')1r3o4(dg')o4(eg)o4(dg')o4(eg)o4(cg')6o4(ea)6o3(be)6o4e<(af)o3(bg)o4(ca)12|ikv6t2eb>g'de<bgbeb>g'gagg'd<eb>g'de<bgbeb>g'gagg'd<eb>g'de<bgbeb>g'gagg'd<eb>g'de<bgbeb>g'gagg'd<eb>ede<bab<(ag')o3(bgb)o4(cac)o3(ag'a)o4eb>ede<bab<(ag')o3(bgb)o4(ae')o4(bg')o4eb>ede<babg'bab(dg')o4(ca)o5deg'<(ed)o5e<bab<(ag')o4(cg)o4eb>ede<bab<(ag')o3(bgb)o4(cac)o3(ag'a)o4eb>ede<bab<(ag')o3(bgb)o4(ae')o4(bg')o4eb>ede<babg'bab(dg')o4(ca)o5deg'<(ed)o5e<bab<(ag')o4(cg)o4ebabgbebab>d<bebabgbebabgbebabgbebab>d<bebabgbebabgbebabgbebab>d<bebabgbebabgbebabgbebab>d<bebabgbebabgbr16>cde4d4c4<b11|ikv6t4r128<b>eger8g6g'e1d1cr8eg'r<(be)o3(ad)o3(gc)r24o3b>eger8g6g'e1d1cr8eg'r<(be)o3(ad)o3(gc)|ikv5t4r64o1c16b16e24r8>e11r1a8e'e11r1c8<b>e11r1c11r1<b11r1>c8de11r1a8e'e11r1c8<b>e11r1c11r1<b11r1>c8d<ebga>d<b>c<ga>d<abebga>d<b>c<ga>d<abebga>d<b>c<ga>d<abebga>d<b>c<ga>d<abr12f19r1e11|ikv5t2r172ce'r8<b4r12g'ed6g'(gb)6o3g'r48>ce'r8<b4r12g'ed6g'(gb)6o3g'|ikv5t2r204<ba4r90ba4r90ba4",
  'instrument-bug': instrumentBug,
  'cross-voice':
    "#lute 120 ilabcdefg'abcdefg'abcdefg'|ikabcdefg'abcdefg'abcdefg'|imabcdefg'abcdefg'abcdefg'",
  'chords-and-octaves':
    "#lute 100 il>c4e4g4c4>c4e4g4c4abababab|ikr2>c4e4g4c4>c4e4g4c4cdcdcdcd|im(ceg)2(ceg)2(ceg)2(ceg)2",
  // Heavy redundant o4 resets — exercises the octave-strip variant.
  'redundant-octave':
    "#lute 140 ilo4cdeo4cdeo4cdeo4cdeo3fgo4cdeo4cdeo4cde|iko4ggo4ggo4ggo4gg",
}

interface OracleResult {
  ok: boolean
  skip: boolean
  reason?: string
  results?: { name: string; match: boolean; error?: string; onlyPlain?: unknown[]; onlyOpt?: unknown[] }[]
}

function runOracle(): OracleResult {
  const pairs = Object.entries(SONGS).map(([name, plain]) => ({
    name,
    plain,
    optimized: optimizeLuting(plain).output,
  }))
  const res = spawnSync('python3', [oracle], { input: JSON.stringify(pairs), encoding: 'utf8' })
  if (res.error || res.status !== 0 || !res.stdout) {
    return { ok: false, skip: true, reason: res.error?.message ?? res.stderr ?? 'python3 unavailable' }
  }
  try {
    return JSON.parse(res.stdout) as OracleResult
  } catch {
    return { ok: false, skip: true, reason: `unparseable oracle output: ${res.stdout.slice(0, 200)}` }
  }
}

const oracleResult = runOracle()

describe('optimiser output vs the real LuteBoi parser', () => {
  if (oracleResult.skip) {
    it.skip(`skipped: ${oracleResult.reason}`, () => {})
    return
  }

  for (const name of Object.keys(SONGS)) {
    it(`${name} plays identically after optimisation`, () => {
      const r = oracleResult.results?.find((x) => x.name === name)
      expect(r, 'oracle returned a result for this song').toBeDefined()
      // surface the diff in the failure message when it mismatches
      expect(r).toMatchObject({ match: true })
    })
  }
})
