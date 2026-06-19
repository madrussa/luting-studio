#!/usr/bin/env python
"""Re-analyze the faithful renders: (1) bean vs LuteBoi envelope confirmation,
(2) isolate loop-TURN pops from the sample's intrinsic roughness using exact
turning-point output positions."""
import os, math, json, base64, subprocess
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.io import wavfile
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("HARNESS_OUT", os.path.join(HERE, "out"))
os.makedirs(OUT, exist_ok=True)
SR = 44100

# import render_faithful as a module to reuse render_note
spec = importlib.util.spec_from_file_location("rf", f"{HERE}/render_faithful.py")
# avoid re-running its __main__ scan: read & exec only the defs by trimming.
# simpler: re-implement minimal hooks via subprocess-free reuse -> just import; it will re-run.
# To skip the heavy scan, set an env flag the script checks. Instead, re-declare here:

RELEASE, PEAK, ATTACK, LEG_STAC, DECAY_TAU = 0.08, 0.8, 0.005, 0.9, 3000/44100
PK = os.environ.get("LUTING_SAMPLES", os.path.abspath(os.path.join(HERE, "../../public/samples")))
_c = {}
def decode(code, midi):
    if (code, midi) in _c: return _c[(code, midi)]
    pack = json.load(open(f"{PK}/{code}.json"))
    raw = subprocess.run(["ffmpeg","-v","error","-i","pipe:0","-ac","1","-ar",str(SR),"-f","f32le","-"],
        input=base64.b64decode(pack["notes"][str(midi)]), capture_output=True, check=True).stdout
    b = np.frombuffer(raw, dtype="<f4").astype(np.float64).copy(); _c[(code,midi)]=(b,pack["loop"]); return b,pack["loop"]
def keys(code):
    d=json.load(open(f"{PK}/{code}.json")); return sorted(int(k) for k in d["notes"] if k.lstrip("-").isdigit()), d["loop"]
def bake(buf0, W):
    N=len(buf0); ls=int(N*0.30); le=int(N*0.85); L=le-ls; W=min(W,L-2)
    region=np.concatenate([buf0[ls:le], buf0[le-2:ls:-1]]).astype(np.float64); P=len(region)
    at=lambda i: buf0[max(0,min(N-1,i))]
    def sm(ai,ab,fwd):
        for d in range(-W,W+1):
            wt=0.5*(1-math.cos(math.pi*(d+W)/(2*W)))
            pin=at(ab+d) if fwd else at(ab-d); pout=at(ab-d) if fwd else at(ab+d)
            region[(ai+d)%P]=(1-wt)*pin+wt*pout
    if W>0: sm(L-1,le-1,True); sm(0,ls,False)
    return np.concatenate([buf0[:ls],region]).astype(np.float64), ls, ls+P, L
def env(t,holdEnd):
    decAt=max(ATTACK,LEG_STAC*max(0.03,holdEnd)); g=np.zeros_like(t)
    a=t<ATTACK; g[a]=PEAK*(t[a]/ATTACK); h=(t>=ATTACK)&(t<decAt); g[h]=PEAK
    dur=max(holdEnd-decAt,1e-9); tgt=max(PEAK*math.exp(-dur/DECAY_TAU),1e-5)
    dd=(t>=decAt)&(t<holdEnd); g[dd]=PEAK*(tgt/PEAK)**((t[dd]-decAt)/dur)
    r=t>=holdEnd; g[r]=tgt*np.clip(1-(t[r]-holdEnd)/RELEASE,0,1); return g
def render(code,midi,D,W=int(SR*0.008)):
    ks,loop=keys(code); best=min(ks,key=lambda m:abs(m-midi)); rate=2.0**((midi-best)/12)
    raw,_=decode(code,best)
    if loop: buf,ls,le,L=bake(raw,W)
    else: buf,ls,le,L=raw,0,len(raw),0
    N=len(buf); holdEnd=max(0.03,D); total=int(round((holdEnd+RELEASE)*SR))
    looping=loop and (N/SR/rate)<(D+RELEASE); loopLen=le-ls
    idx=np.arange(total); un=idx*rate
    pos=np.where(un<le, un, ls+np.mod(un-ls,loopLen)) if looping else un
    i0=np.floor(pos).astype(int); fr=pos-i0
    s=buf[np.clip(i0,0,N-1)]*(1-fr)+buf[np.clip(i0+1,0,N-1)]*fr
    if not looping: s[pos>=N]=0
    return s*env(idx/SR,holdEnd), dict(rate=rate,looping=looping,ls=ls,le=le,L=L,loopLen=loopLen,holdEnd=holdEnd,best=best)

def turn_indices(m, total):
    """output sample indices of TP1 (high) and TP2 (wrap) turns."""
    if not m["looping"]: return []
    ls,le,L,loopLen,r=m["ls"],m["le"],m["L"],m["loopLen"],m["rate"]
    tps=[]
    k=0
    while True:
        i1=(ls+(L-1)+k*loopLen)/r       # TP1
        i2=(le+k*loopLen)/r             # TP2 (first wrap at k=0 -> le/r)
        if i1>=total and i2>=total: break
        if i1<total: tps.append(int(round(i1)))
        if i2<total: tps.append(int(round(i2)))
        k+=1
    return [i for i in tps if 0<i<total-3]

def turn_vs_intrinsic(out, m):
    """max|d2| at turn windows vs intrinsic 99.5-pct |d2| in body excluding turns."""
    d2=np.abs(np.diff(out,2))
    total=len(out)
    tps=turn_indices(m, total)
    win=int(SR*0.0007)  # +-0.7ms
    turnmask=np.zeros(total-2, bool)
    turn_peak=0.0; turn_at=0
    for tp in tps:
        a,b=max(0,tp-win),min(total-2,tp+win)
        turnmask[a:b]=True
        if b>a:
            mx=d2[a:b].max()
            if mx>turn_peak: turn_peak=mx; turn_at=tp
    body_start=int((m["ls"]/m["rate"]+0.01)*SR) if m["looping"] else int(0.05*SR)
    body_end=int((m["holdEnd"]-0.05)*SR)
    bmask=np.zeros(total-2,bool); bmask[body_start:body_end]=True; bmask&=~turnmask
    intrinsic=np.percentile(d2[bmask],99.5) if bmask.sum()>50 else d2[bmask].max() if bmask.any() else 1e-9
    return turn_peak, intrinsic+1e-12, turn_at/SR, len(tps)

# ---------- (1) bean vs LuteBoi envelope confirmation ----------
def rms(x,w=441):
    n=len(x)//w; return np.sqrt((x[:n*w].reshape(n,w)**2).mean(1)), (np.arange(n)*w+w/2)/SR
def onset(x,thr=0.02):
    a=np.abs(x); i=np.argmax(a>thr*a.max()); return max(0,i)
for secs in (0.5,2.0,6.0):
    lb_sr,lb=wavfile.read(f"{OUT}/luteboi_bean_{secs}s.wav"); lb=lb.astype(float)/32768
    lt,_=render("t",60,secs);
    o=onset(lb); lb=lb[o:]
    fig,ax=plt.subplots(figsize=(13,3.4))
    r1,t1=rms(lt); r2,t2=rms(lb)
    ax.plot(t2,r2,lw=1,label="luteboi",color="tab:blue")
    ax.plot(t1,r1,lw=1,label="luting faithful (ping-pong + LuteBoi env)",color="tab:red")
    ax.axvline(0.9*max(0.03,secs),ls="--",color="gray",lw=.8,label="decay onset (0.9·len)")
    ax.set_title(f"RMS envelope — bean C4 {secs}s : faithful luting vs LuteBoi"); ax.set_xlabel("s"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(f"{OUT}/envelope_faithful_{secs}s.png",dpi=96); plt.close(fig)
print("envelope_faithful PNGs written")

# ---------- (2) turn-vs-intrinsic table ----------
INSTR=["t","k","f","o","e","v","g","a"]; LENS=[3.0,6.0]
print(f"\n{'inst':4}{'midi':5}{'rate':6}{'len':5}{'turnPk':>9}{'intrins':>9}{'turn/intr':>10}{'nTurns':>7}{'turn@s':>8}")
worst=[]
for code in INSTR:
    ks,loop=keys(code); ex=min(ks,key=lambda m:abs(m-60))
    for midi in (ex,ex+1,ex+2):
        for D in LENS:
            out,m=render(code,midi,D)
            tp,intr,tat,nt=turn_vs_intrinsic(out,m)
            ratio=tp/intr
            worst.append((ratio,code,midi,m["rate"],D,tp,intr,tat))
            print(f"{code:4}{midi:5}{m['rate']:6.3f}{D:5}{tp:9.4f}{intr:9.4f}{ratio:10.2f}{nt:7}{tat:8.3f}")
worst.sort(reverse=True)
print("\nTOP turn/intrinsic offenders:", [(round(w[0],2),w[1],w[2]) for w in worst[:5]])

# zoom plot for the top offender + organ (loudest)
def zoom_turn(code,midi,D,tag):
    out,m=render(code,midi,D); tps=turn_indices(out.__len__() and m or m, len(out))
    tps=turn_indices(m,len(out))
    if not tps: return
    tp=tps[len(tps)//2]; w=int(SR*0.01)
    fig,ax=plt.subplots(figsize=(11,3))
    seg=out[tp-w:tp+w]; ts=(np.arange(len(seg))-w)/SR*1000
    ax.plot(ts,seg,lw=.8); ax.axvline(0,color="r",ls=":",lw=.8)
    ax.set_title(f"{tag}: {code} midi{midi} rate{m['rate']:.3f} — loop turn zoom (±10ms)"); ax.set_xlabel("ms from turn")
    fig.tight_layout(); fig.savefig(f"{OUT}/turnzoom_{tag}.png",dpi=96); plt.close(fig)
zoom_turn(worst[0][1],worst[0][2],6.0,"top")
zoom_turn("o",61,6.0,"organ")
print("turnzoom PNGs written")
