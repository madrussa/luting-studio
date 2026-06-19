# Audio harness — luting vs LuteBoi

Offline renderers + analysis used to settle how `src/lib/samples.ts` should loop and
shape sampled notes, by comparing our Web Audio output against the real LuteBoi
renderer. It produced the evidence behind two changes:

- **Ping-pong loop** (`bakePingpong`) instead of a forward crossfade loop — kills the
  ~0.75 s amplitude "throb" (a forward loop resets the level every pass) and the
  loop-seam pop.
- **LuteBoi-faithful envelope** — hold the sample's own level until 90 % of the note
  (`LEG_STAC`), then a fixed ~68 ms ring-down (`DECAY_TAU = 3000/44100`), uniform across
  all sampled voices. Keeps the intended held "drone".

## Scripts

| file | what it does |
|------|--------------|
| `render_luteboi.py` | Renders bean C4 at 0.5/2/6 s via the **real** `lute.synth.pysynth_samp.make_wav` loaded from your `LUTEBOI_DIR` checkout, bypassing the Django cache with a monkeypatched `caches['voices']`. Applies the one numpy-2 fix (`.tostring()` → `.tobytes()`) in memory — LuteBoi's GPL source is **not** vendored into this repo. |
| `render_faithful.py` | Faithful Python port of the **shipped** `samples.ts` playback (ping-pong loop W=8 ms + LuteBoi envelope). Renders bean and runs the broad pop scan (voices × pitches incl. pitch-shift × lengths + note-to-note transitions). |
| `analyze_faithful.py` | Confirms our envelope matches LuteBoi (RMS overlay) and isolates loop-turn discontinuities from each sample's intrinsic roughness. Writes `envelope_faithful_*.png`, `turnzoom_*.png`. |

## Setup

```sh
python3 -m venv venv
./venv/bin/pip install numpy scipy matplotlib django
```

Also requires `ffmpeg`/`ffprobe` on PATH (decodes the ogg samples) and a LuteBoi checkout
for `render_luteboi.py`.

## Run

```sh
./venv/bin/python render_luteboi.py    # ground-truth WAVs
./venv/bin/python render_faithful.py   # our output + pop scan
./venv/bin/python analyze_faithful.py  # comparison plots
```

Outputs (WAVs, PNGs, `.npy`) land in `out/` (gitignored).

## Paths (env-overridable)

| var | default |
|-----|---------|
| `LUTEBOI_DIR` | `~/Development/LuteBoi` |
| `LUTING_SAMPLES` | `../../public/samples` (this repo) |
| `HARNESS_OUT` | `./out` |
