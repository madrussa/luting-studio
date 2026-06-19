#!/usr/bin/env python3
"""
Oracle for the optimiser tests: parses lutings with the *real* LuteBoi engine
and reports whether two lutings produce the same note schedule.

It reads the LuteBoi parser straight from a checkout of the LuteBoi repo (so it
always matches the live engine) and pulls out just `parse_new_lute` and its two
helpers — the surrounding module imports Django and the synth backends, which we
don't need for parsing. The handful of lookup tables the parser reads are small
and stable, so they're inlined here.

Locate LuteBoi via $LUTEBOI_DIR, else ../LuteBoi, else ~/Development/LuteBoi.

Usage: echo '[{"name","plain","optimized"}, ...]' | python3 lute_oracle.py
Prints JSON: {"ok": bool, "results": [{"name", "match", "plain", "opt"}], ...}
On a missing checkout it prints {"ok": false, "skip": true, "reason": ...}.
"""
import contextlib
import decimal
import io
import json
import os
import re
import sys

# Parsing only reads dict membership and NOTE_ORDER; values are placeholders.
SYNTH_DICT = {k: k for k in "bclkmftdaoeevghijsnq"}
SAMPLE_DICT = {
    "k": "keys", "m": "cats", "f": "flute", "t": "bean", "d": "drumkit",
    "a": "bell", "o": "organ", "e": "choir", "v": "violin", "g": "ocarina",
    "h": "brass", "i": "vibraphone", "j": "overdrive", "s": "saxophone",
    "n": "harmonica", "q": "slapbass",
}
NOTE_ORDER = {
    "c": 0, "d'": 1, "d": 2, "e'": 3, "e": 4, "f'": 5, "f": 6,
    "g'": 7, "g": 8, "a'": 9, "a": 10, "b'": 11, "b": 12, "c'": 13,
}
MAX_LUTE_LENGTH = 300


def find_lutils():
    candidates = []
    if os.environ.get("LUTEBOI_DIR"):
        candidates.append(os.environ["LUTEBOI_DIR"])
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(here, "..", "..", "LuteBoi"))
    candidates.append(os.path.expanduser("~/Development/LuteBoi"))
    for base in candidates:
        path = os.path.join(base, "lute", "lutils.py")
        if os.path.isfile(path):
            return path
    return None


def load_parser(lutils_path):
    """Extract parse_new_lute + helpers from the LuteBoi source and exec them."""
    src = open(lutils_path).read().splitlines()

    def grab(name):
        start = next(i for i, l in enumerate(src) if l.startswith(f"def {name}("))
        end = start + 1
        while end < len(src) and not src[end].startswith("def "):
            end += 1
        return "\n".join(src[start:end])

    ns = dict(
        re=re, decimal=decimal, SYNTH_DICT=SYNTH_DICT, SAMPLE_DICT=SAMPLE_DICT,
        NOTE_ORDER=NOTE_ORDER, MAX_LUTE_LENGTH=MAX_LUTE_LENGTH,
    )
    for fn in ("create_header", "increment_chords", "parse_new_lute"):
        exec(grab(fn), ns)
    return ns["parse_new_lute"]


def main():
    lutils_path = find_lutils()
    if not lutils_path:
        print(json.dumps({"ok": False, "skip": True,
                          "reason": "LuteBoi checkout not found (set LUTEBOI_DIR)"}))
        return

    parse = load_parser(lutils_path)

    def schedule(msg):
        # the parser is chatty on stdout; swallow it
        with contextlib.redirect_stdout(io.StringIO()):
            _tempo, _voices, _stereo, _sample, full = parse(msg)
        return sorted(
            (n, round(b, 5), round(v, 4), s)
            for line in full for (n, b, v, s) in line
        )

    pairs = json.load(sys.stdin)
    results = []
    ok = True
    for p in pairs:
        try:
            a = schedule(p["plain"])
            b = schedule(p["optimized"])
            match = a == b
            entry = {"name": p.get("name", "?"), "match": match,
                     "plain": len(a), "opt": len(b)}
            if not match:
                only_plain = [list(x) for x in (set(map(tuple, a)) - set(map(tuple, b)))][:5]
                only_opt = [list(x) for x in (set(map(tuple, b)) - set(map(tuple, a)))][:5]
                entry["onlyPlain"] = only_plain
                entry["onlyOpt"] = only_opt
        except Exception as ex:  # noqa: BLE001
            match = False
            entry = {"name": p.get("name", "?"), "match": False, "error": str(ex)}
        ok = ok and match
        results.append(entry)

    print(json.dumps({"ok": ok, "skip": False,
                      "lutils": lutils_path, "results": results}))


if __name__ == "__main__":
    main()
