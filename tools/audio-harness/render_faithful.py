#!/usr/bin/env python
"""Faithful port of the SHIPPED samples.ts: ping-pong loop (W=8ms) + LuteBoi
uniform hold-then-sharp-decay envelope. Broad pop scan across sampled voices,
pitches (incl. pitch-shift), lengths, and note-to-note transitions."""
import json, base64, subprocess, math, os
import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("HARNESS_OUT", os.path.join(HERE, "out"))
os.makedirs(OUT, exist_ok=True)
PK = os.environ.get("LUTING_SAMPLES", os.path.abspath(os.path.join(HERE, "../../public/samples")))
SR = 44100
RELEASE = 0.08
PEAK = 0.8
ATTACK = 0.005
LEG_STAC = 0.9
DECAY_TAU = 3000 / 44100

_cache = {}
def decode(code, midi):
    key = (code, midi)
    if key in _cache: return _cache[key]
    pack = json.load(open(f"{PK}/{code}.json"))
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        input=base64.b64decode(pack["notes"][str(midi)]), capture_output=True, check=True).stdout
    buf = np.frombuffer(raw, dtype="<f4").astype(np.float64).copy()
    _cache[key] = (buf, pack["loop"])
    return buf, pack["loop"]

def pack_keys(code):
    d = json.load(open(f"{PK}/{code}.json"))
    return sorted(int(k) for k in d["notes"] if k.lstrip("-").isdigit()), d["loop"]

def bake_pingpong(buf0, W):
    N = len(buf0)
    ls = int(N * 0.30); le = int(N * 0.85); L = le - ls
    W = min(W, L - 2)
    forward = buf0[ls:le]
    reverse = buf0[le - 2: ls: -1]
    region = np.concatenate([forward, reverse]).astype(np.float64)
    P = len(region)
    def at(i): return buf0[max(0, min(N - 1, i))]
    def smooth(apex_idx, apex_buf, incoming_fwd):
        for d in range(-W, W + 1):
            wt = 0.5 * (1 - math.cos(math.pi * (d + W) / (2 * W)))
            pin = at(apex_buf + d) if incoming_fwd else at(apex_buf - d)
            pout = at(apex_buf - d) if incoming_fwd else at(apex_buf + d)
            region[(apex_idx + d) % P] = (1 - wt) * pin + wt * pout
    if W > 0:
        smooth(L - 1, le - 1, True)
        smooth(0, ls, False)
    newbuf = np.concatenate([buf0[:ls], region]).astype(np.float64)
    return newbuf, ls, ls + P  # loopStart, loopEnd (samples) in newbuf

def gain_env(t, holdEnd):
    """Vectorized LuteBoi-faithful envelope."""
    decAt = max(ATTACK, LEG_STAC * max(0.03, holdEnd))
    g = np.zeros_like(t)
    a = t < ATTACK
    g[a] = PEAK * (t[a] / ATTACK)
    h = (t >= ATTACK) & (t < decAt)
    g[h] = PEAK
    dur = max(holdEnd - decAt, 1e-9)
    target = max(PEAK * math.exp(-dur / DECAY_TAU), 1e-5)
    dd = (t >= decAt) & (t < holdEnd)
    g[dd] = PEAK * (target / PEAK) ** ((t[dd] - decAt) / dur)
    r = t >= holdEnd
    g[r] = target * np.clip(1.0 - (t[r] - holdEnd) / RELEASE, 0.0, 1.0)
    return g

def render_note(code, midi, D, W=int(SR * 0.008)):
    keys, loop = pack_keys(code)
    best = min(keys, key=lambda m: abs(m - midi))
    rate = 2.0 ** ((midi - best) / 12.0)
    rawbuf, _ = decode(code, best)
    if loop:
        buf, ls, le = bake_pingpong(rawbuf, W)
    else:
        buf, ls, le = rawbuf, 0, len(rawbuf)
    N = len(buf)
    holdEnd = max(0.03, D)
    total = int(round((holdEnd + RELEASE) * SR))
    bufDur = N / SR
    looping = loop and (bufDur / rate) < (D + RELEASE)
    loopLen = le - ls
    idx = np.arange(total)
    unwrapped = idx * rate
    if looping:
        pos = np.where(unwrapped < le, unwrapped,
                       ls + np.mod(unwrapped - ls, loopLen))
    else:
        pos = unwrapped
    i0 = np.floor(pos).astype(int)
    frac = pos - i0
    i0c = np.clip(i0, 0, N - 1); i1c = np.clip(i0 + 1, 0, N - 1)
    s = buf[i0c] * (1 - frac) + buf[i1c] * frac
    if not looping:
        s[pos >= N] = 0.0
    t = idx / SR
    out = s * gain_env(t, holdEnd)
    return out, dict(best=best, rate=rate, looping=looping, ls=ls, le=le, N=N,
                     loopLen=loopLen, decAt=max(ATTACK, LEG_STAC * holdEnd), holdEnd=holdEnd)

def pops(out, meta, length):
    d1 = np.abs(np.diff(out))
    d2 = np.abs(np.diff(out, 2))
    # steady region for baselines: between attack and decay onset
    s0 = int((ATTACK + 0.02) * SR)
    s1 = int(meta["decAt"] * SR)
    base = out[s0:s1] if s1 > s0 + 100 else out[s0:]
    med1 = np.median(np.abs(np.diff(base))) + 1e-12
    med2 = np.median(np.abs(np.diff(base, 2))) + 1e-12
    a1 = int(np.argmax(d1)); a2 = int(np.argmax(d2))
    def loc(i):
        ts = i / SR
        if ts < ATTACK + 0.003: return "attack"
        if ts >= meta["holdEnd"] - 0.001: return "end/release"
        if meta["looping"]:
            ph = (i * meta["rate"] - meta["ls"]) % meta["loopLen"] if meta["loopLen"] else 0
            # apexes at phase 0 and L-1 (== loopLen/2 +? ) -> just call it loop-region
            return "loop-turn"
        return "body"
    return dict(maxd1=d1[a1], d1_loc=loc(a1), d1_t=a1 / SR, d1_ratio=d1[a1] / med1,
                maxd2=d2[a2], d2_loc=loc(a2), d2_t=a2 / SR, d2_ratio=d2[a2] / med2)

# ============================================================================
# 1+2. Bean vs LuteBoi envelope confirmation (MIDI 60, rate 1)
# ============================================================================
for secs in (0.5, 2.0, 6.0):
    out, meta = render_note("t", 60, secs)
    wavfile.write(f"{OUT}/luting_faithful_bean_{secs}s.wav", SR, (out * 32767).astype(np.int16))
print("bean faithful renders done; meta sample:", meta)

# ============================================================================
# 3. Broad pop scan
# ============================================================================
INSTR = ["t", "k", "f", "o", "e", "v", "g", "a"]
LENS = [0.3, 3.0, 6.0]
rows = []
for code in INSTR:
    keys, loop = pack_keys(code)
    exact = min(keys, key=lambda m: abs(m - 60))
    pitches = [(exact, "exact r=1"), (exact + 1, "+1st"), (exact + 2, "+2st")]
    for midi, plabel in pitches:
        for D in LENS:
            out, meta = render_note(code, midi, D)
            p = pops(out, meta, D)
            rows.append((code, midi, plabel, round(meta["rate"], 3), D, meta["looping"], p))

# note-to-note transitions (same pitch retrigger + different pitch), 0.8s each
def transition(code, m1, m2, D=0.8):
    o1, meta1 = render_note(code, m1, D)
    o2, meta2 = render_note(code, m2, D)
    start2 = int(round(D * SR))  # next note begins at prev note's holdEnd
    total = start2 + len(o2)
    mix = np.zeros(total)
    mix[:len(o1)] += o1
    mix[start2:start2 + len(o2)] += o2
    # discontinuity right at the boundary
    w = slice(start2 - 50, start2 + 50)
    d2 = np.abs(np.diff(mix, 2))
    seam = np.max(np.abs(np.diff(mix[w], 2)))
    med2 = np.median(np.abs(np.diff(mix[int((ATTACK+0.02)*SR):start2-100], 2))) + 1e-12
    return mix, seam, seam / med2, start2

trans_rows = []
for code in ["t", "k", "o", "v"]:
    keys, _ = pack_keys(code)
    e = min(keys, key=lambda m: abs(m - 60))
    mix, seam, ratio, st = transition(code, e, e)       # same pitch
    trans_rows.append((code, "same", seam, ratio))
    mix, seam, ratio, st = transition(code, e, e + 4)   # different pitch
    trans_rows.append((code, "diff", seam, ratio))

np.save(f"{OUT}/_faithful_scan.npy", np.array(
    {"rows": rows, "trans": trans_rows}, dtype=object), allow_pickle=True)

print("\n=== POP SCAN (sorted by |d2|/median) ===")
print(f"{'inst':4} {'midi':4} {'pitch':9} {'rate':5} {'len':4} {'loop':5} "
      f"{'|d1|':>7} {'d1loc':11} {'|d2|':>7} {'d2/med':>8} {'d2loc':11} {'d2@s':>6}")
for code, midi, pl, rate, D, looping, p in sorted(rows, key=lambda r: -r[6]["d2_ratio"]):
    print(f"{code:4} {midi:4} {pl:9} {rate:5.3f} {D:4} {str(looping):5} "
          f"{p['maxd1']:7.4f} {p['d1_loc']:11} {p['maxd2']:7.4f} {p['d2_ratio']:8.1f} "
          f"{p['d2_loc']:11} {p['d2_t']:6.3f}")

print("\n=== NOTE-TO-NOTE TRANSITIONS ===")
print(f"{'inst':4} {'kind':5} {'seam|d2|':>9} {'seam/med':>9}")
for code, kind, seam, ratio in trans_rows:
    print(f"{code:4} {kind:5} {seam:9.5f} {ratio:9.1f}")
print("DONE faithful scan")
