// Song key signatures for notation mode. Luting spells black keys as flats
// only (b' = B♭, g' = enharmonic F♯), so only flat keys + C are cleanly
// representable. A key here just flips the *default* accidental on the staff
// letters it flattens — it's an input/display convenience and never changes
// the stored or played notes (those stay concrete, LuteBoi-compatible pitches).

export interface MusicKey {
  id: string
  label: string
  /** staff letters this key flattens by default, e.g. ['b','e'] for B♭ major */
  flats: string[]
}

// The order flats accumulate across the flat keys: B, E, A, D, G, C.
const FLAT_ORDER = ['b', 'e', 'a', 'd', 'g', 'c']

export const KEYS: MusicKey[] = [
  { id: 'C', label: 'C major', flats: [] },
  { id: 'F', label: 'F major', flats: FLAT_ORDER.slice(0, 1) },
  { id: 'Bb', label: 'B♭ major', flats: FLAT_ORDER.slice(0, 2) },
  { id: 'Eb', label: 'E♭ major', flats: FLAT_ORDER.slice(0, 3) },
  { id: 'Ab', label: 'A♭ major', flats: FLAT_ORDER.slice(0, 4) },
  { id: 'Db', label: 'D♭ major', flats: FLAT_ORDER.slice(0, 5) },
  { id: 'Gb', label: 'G♭ major', flats: FLAT_ORDER.slice(0, 6) },
]

export const keyById = (id: string): MusicKey => KEYS.find((k) => k.id === id) ?? KEYS[0]

/** Does this key flatten the given staff letter (c..b) by default? */
export const keyFlattens = (key: MusicKey, letter: string): boolean => key.flats.includes(letter)
