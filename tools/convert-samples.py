#!/usr/bin/env python3
"""
Convert LuteBoi's raw JSON sample banks into compact web packs.

Each source bank (synth/samples/<name>.json) is a dict of note-name -> raw
44.1kHz mono float PCM, plus a "loop" flag. We:
  - select a sparse multisample (every STRIDE semitones; drums keep all notes),
  - cap length, encode each note to OGG Vorbis (via ffmpeg),
  - emit public/samples/<code>.json = { loop, rate, notes: { key: base64-ogg } }

Melodic notes are keyed by MIDI number; drum notes by our drum keys (o0a ...),
matching DRUM_SOUNDS so the engine can look them up exactly.
"""
import json, os, sys, wave, struct, subprocess, base64, tempfile

SRC = '/Users/russell/Development/LuteBoi/lute/synth/samples'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples')
STRIDE = 3            # melodic: one sample every 3 semitones (4 per octave)
CAP_SEC = 2.5         # cap each sample length
VORBIS_Q = 3

# our instrument code -> LuteBoi bank filename
BANKS = {
    'k': 'keys', 'm': 'cats', 'f': 'flute', 't': 'bean', 'd': 'drumkit',
    'a': 'bell', 'o': 'organ', 'e': 'choir', 'v': 'violin', 'g': 'ocarina',
    'h': 'brass', 'i': 'vibraphone', 'j': 'overdrive', 's': 'saxophone',
    'n': 'harmonica', 'q': 'slapbass',
}

SEMI = {'c': 0, 'db': 1, 'd': 2, 'eb': 3, 'e': 4, 'f': 5, 'gb': 6, 'g': 7, 'ab': 8, 'a': 9, 'bb': 10, 'b': 11}


def note_to_midi(name):
    octv = int(name[-1])
    letter = name[:-1]
    return 12 * (octv + 1) + SEMI[letter]


def encode_ogg(arr):
    cap = int(CAP_SEC * 44100)
    arr = arr[:cap]
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as wf:
        wav = wf.name
    with tempfile.NamedTemporaryFile(suffix='.ogg', delete=False) as of:
        ogg = of.name
    try:
        w = wave.open(wav, 'w')
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
        w.writeframes(b''.join(struct.pack('<h', max(-32768, min(32767, int(round(x))))) for x in arr))
        w.close()
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
                        '-c:a', 'libvorbis', '-q:a', str(VORBIS_Q), ogg], check=True)
        with open(ogg, 'rb') as fh:
            return base64.b64encode(fh.read()).decode('ascii')
    finally:
        for p in (wav, ogg):
            try: os.remove(p)
            except OSError: pass


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    grand_total = 0
    for code, bank in BANKS.items():
        path = os.path.join(SRC, bank + '.json')
        if not os.path.exists(path):
            print('  missing', path); continue
        d = json.load(open(path))
        loop = bool(d.get('loop'))
        notes_in = [k for k in d if k != 'loop']

        out_notes = {}
        if code == 'd':
            # drumkit: keep every recorded note, keyed by our drum key (o<oct><letter>)
            for n in notes_in:
                octv = n[-1]; letter = n[:-1]
                # only single-letter drum positions are used by DRUM_SOUNDS
                if letter in ('a', 'b', 'c', 'd', 'e', 'f', 'g'):
                    out_notes[f'o{octv}{letter}'] = encode_ogg(d[n])
        else:
            by_midi = sorted(((note_to_midi(n), n) for n in notes_in))
            base = by_midi[0][0]
            for midi, n in by_midi:
                if (midi - base) % STRIDE == 0:
                    out_notes[str(midi)] = encode_ogg(d[n])

        pack = {'loop': loop, 'rate': 44100, 'notes': out_notes}
        outpath = os.path.join(OUT, code + '.json')
        json.dump(pack, open(outpath, 'w'), separators=(',', ':'))
        size = os.path.getsize(outpath)
        grand_total += size
        index.append(code)
        print(f'  {code} ({bank}): {len(out_notes)} notes, {size/1024:.0f} KB  loop={loop}')

    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'))
    print(f'total: {grand_total/1024/1024:.2f} MB across {len(index)} instruments')


if __name__ == '__main__':
    main()
