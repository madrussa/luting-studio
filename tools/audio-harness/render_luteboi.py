#!/usr/bin/env python
"""Render bean C4 notes at several lengths using the REAL LuteBoi pysynth_samp.make_wav,
bypassing Django's cache via monkeypatch."""
import sys, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
LUTEBOI = os.environ.get("LUTEBOI_DIR", os.path.expanduser("~/Development/LuteBoi"))
sys.path.insert(0, LUTEBOI)

# Provide a minimal django settings so `from django.conf import settings` etc. don't explode.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "luteboi.settings")
import django
from django.conf import settings
if not settings.configured:
    try:
        django.setup()
    except Exception as e:
        print("django.setup() note:", e)

# Load LuteBoi's real pysynth_samp from the local checkout and apply, in memory,
# the only numpy-2 fix needed to run it standalone (.tostring() -> .tobytes()).
# The GPL source is NOT vendored into this repo -- it stays in your LUTEBOI_DIR.
import types
_src_path = os.path.join(LUTEBOI, "lute/synth/pysynth_samp.py")
_src = open(_src_path).read().replace(".tostring()", ".tobytes()")
pysynth_samp = types.ModuleType("pysynth_samp")
pysynth_samp.__file__ = _src_path
sys.modules["pysynth_samp"] = pysynth_samp
exec(compile(_src, _src_path, "exec"), pysynth_samp.__dict__)

# Bypass the Django cache: provide a fake caches dict whose 'voices'.get(path) returns bean.json
bean = json.load(open(os.path.join(LUTEBOI, "lute/synth/samples/bean.json")))

class FakeCache:
    def __init__(self, data):
        self.data = data
    def get(self, path):
        return self.data

pysynth_samp.caches = {"voices": FakeCache(bean)}

OUT = os.environ.get("HARNESS_OUT", os.path.join(HERE, "out"))
os.makedirs(OUT, exist_ok=True)

# length(l) = 88200/l samples at bpm=120 -> for N seconds: value = 2.0/N
for secs in (0.5, 2.0, 6.0):
    value = 2.0 / secs
    song = [("c4", value, 1.0, 0)]
    fn = os.path.join(OUT, f"luteboi_bean_{secs}s.wav")
    pysynth_samp.make_wav(song, bpm=120, leg_stac=.9, fn=fn, patch_path="bean", silent=True)
    print("wrote", fn)
print("DONE luteboi")
