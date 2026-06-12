# Luting Studio

A single-page app for composing and converting **lutings** — the compact music
notation used by [luteboi.com](https://luteboi.com/)
([syntax reference](https://github.com/AnAnnoyingCat/lutingsyntax)).

## Features

- **Instrument palette with drag & drop** — all 20 luteboi instruments.
  Drag one onto the board to add a voice, drop it onto an existing voice to
  swap its instrument, click a chip to audition it. Voices can be reordered
  by their drag handle.
- **MIDI → luting** — drop a `.mid` file on the converter. Tempo becomes
  `#lute` (4× song BPM so `t1` = a sixteenth), notes are quantized to that
  grid, simultaneous equal-length notes become chords, overlapping lines are
  split into extra voices, and the GM drum channel is mapped onto the
  luteboi Drumkit (`id`).
- **MP3/audio → luting** — best-effort monophonic transcription using
  autocorrelation pitch detection. Works on clean single-line audio
  (whistling, humming, one instrument); full mixes won't transcribe. Set the
  song BPM before converting.
- **Luting import** — paste an existing luting into the import box and it is
  split into voices on the board: the `#lute` BPM is picked up, each voice's
  `i<code>` marker becomes its instrument selector, and comments/whitespace
  are stripped. Importing replaces the current board.
- **In-browser preview** — a Web Audio approximation of the instruments so
  you can audition lutings (whole song or solo voice) without leaving the
  page. For the real sound, copy the luting into luteboi.com.
- **Character counter** against the 493-char Twitch cheer limit.
- **Song library** (IndexedDB) — save the board under a name, browse saved
  lutings with metadata, load or delete them. Ctrl/Cmd+S quick-saves the open
  song. The working board also auto-persists to localStorage separately.
- **Built-in optimizer** — "thorough"-style macro compression: existing
  macros are expanded, then repeated token sequences are extracted into
  `A{...}` macros (up to 26 names) with repeat counts (`A4`). It works on
  whole tokens only (never splits `g'4`, `o3`, `(ceg)2`, or crosses a `|`),
  so the result is provably identical — a self-check parses both versions
  and compares full note schedules before accepting. Typical saving on
  converted MIDIs: 50–70%. If the result is still over one cheer, it is also
  offered as a **multilute** (the `#lute m ...` multi-message format), with
  per-message copy buttons. Multilutes can be pasted back into the import
  box and are rejoined automatically.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Notes on conversion fidelity

- MIDI files with mid-song tempo changes are converted using the first tempo
  only (a warning is shown).
- Chords with wide internal gaps use `>` inside the parentheses; luteboi's
  ascending-chord rule covers the common cases.
- The built-in optimizer is greedy; luteboi's own optimizer may squeeze out
  a little more on lutings that are already near-optimal.
