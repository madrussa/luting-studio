// Preset drum-machine patterns for the Drumkit roll: classic one-bar beats
// on the 16-step grid (1 step = 1 unit = a sixteenth), appended to a voice
// at the next bar boundary. Drum keys are DRUM_SOUNDS keys (o0a = kick…).

import type { RollNote } from './transform'

export interface DrumPattern {
  id: string
  label: string
  /** bar length in grid units (16 = 4/4, 12 = 3/4) */
  barUnits: number
  hits: { drum: string; steps: number[] }[]
}

export const DRUM_PATTERNS: DrumPattern[] = [
  {
    id: 'rock',
    label: 'Rock',
    barUnits: 16,
    hits: [
      { drum: 'o0a', steps: [0, 8] }, // kick
      { drum: 'o3c', steps: [4, 12] }, // snare
      { drum: 'o4c', steps: [0, 2, 4, 6, 8, 10, 12, 14] }, // closed hat 8ths
    ],
  },
  {
    id: 'house',
    label: 'House',
    barUnits: 16,
    hits: [
      { drum: 'o0a', steps: [0, 4, 8, 12] }, // four on the floor
      { drum: 'o3a', steps: [4, 12] }, // clap
      { drum: 'o4a', steps: [2, 6, 10, 14] }, // open hat off-beats
    ],
  },
  {
    id: 'shuffle',
    label: 'Shuffle',
    barUnits: 16,
    hits: [
      { drum: 'o0a', steps: [0, 8] },
      { drum: 'o3c', steps: [4, 12] },
      { drum: 'o4c', steps: [0, 3, 4, 7, 8, 11, 12, 15] }, // long-short hats
    ],
  },
  {
    id: 'funk',
    label: 'Funk',
    barUnits: 16,
    hits: [
      { drum: 'o0a', steps: [0, 3, 6, 10] },
      { drum: 'o3c', steps: [4, 12] },
      { drum: 'o4c', steps: [0, 2, 4, 6, 8, 10, 12, 14] },
      { drum: 'o4a', steps: [7] }, // open-hat kiss before beat 3
    ],
  },
  {
    id: 'waltz',
    label: 'Waltz (3/4)',
    barUnits: 12,
    hits: [
      { drum: 'o0a', steps: [0] },
      { drum: 'o2a', steps: [4, 8] }, // rim on 2 and 3
    ],
  },
  {
    id: 'fill',
    label: 'Fill',
    barUnits: 16,
    hits: [
      { drum: 'o0a', steps: [0] },
      { drum: 'o3c', steps: [4, 6, 8, 10] },
      { drum: 'o2c', steps: [12] }, // high tom
      { drum: 'o1a', steps: [13] }, // mid tom
      { drum: 'o1c', steps: [14, 15] }, // low tom
    ],
  },
]

/** The pattern's one-shot hits (1-unit notes) placed at `startUnit`. */
export function patternRollNotes(p: DrumPattern, startUnit: number): RollNote[] {
  const out: RollNote[] = []
  for (const h of p.hits) {
    for (const s of h.steps) out.push({ start: startUnit + s, dur: 1, drum: h.drum })
  }
  return out.sort((a, b) => a.start - b.start)
}
