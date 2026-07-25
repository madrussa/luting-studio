import { useRef, useState } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { convertMidi, MAX_CONVERT_VOICES, DEFAULT_CONVERT_VOICES } from "../lib/convert";
import type { ConvertResult } from "../lib/convert";
import { convertAudio } from "../lib/pitch";
import { INSTRUMENTS, importLuting } from "../lib/luting";
import { unoptimizeLuting } from "../lib/optimize";
import type { FullMixProgress, StemName } from "../lib/stems/types";
import { FileMusic, Loader2, Import, Check, Minus, AlertTriangle, Sparkles } from "lucide-react";
import { NumberInput } from "./NumberInput";
import dumbUrl from "../assets/dumb.webp";

const STEM_LABELS: Record<StemName, string> = {
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  vocals: "Vocals",
  guitar: "Guitar",
  piano: "Piano",
};

const MB = 1024 * 1024;

function StemProgress({ progress }: { progress: FullMixProgress }) {
  if (progress.stage === "decode") {
    return (
      <span>
        <Loader2 size={15} className="spin" /> Decoding audio…
      </span>
    );
  }
  if (progress.stage === "download") {
    const pct = progress.totalBytes > 0 ? progress.loadedBytes / progress.totalBytes : 0;
    return (
      <span className="stem-progress">
        <span>
          {progress.fromCache
            ? "Loading the instrument-separation model from cache…"
            : `Downloading the instrument-separation model (one-time) — ${Math.round(
                progress.loadedBytes / MB
              )} / ${Math.round(progress.totalBytes / MB)} MB`}
        </span>
        <span className="progress-track">
          <span className="progress-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
        </span>
      </span>
    );
  }
  if (progress.stage === "separate") {
    const pct = progress.total > 0 ? progress.done / progress.total : 0;
    return (
      <span className="stem-progress">
        <span>
          <Loader2 size={15} className="spin" /> Separating instruments — part {Math.min(progress.done + 1, progress.total)} of{" "}
          {progress.total}
        </span>
        <span className="progress-track">
          <span className="progress-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
        </span>
      </span>
    );
  }
  return (
    <span className="stem-progress">
      <span>Transcribing instruments…</span>
      <span className="stem-chips">
        {progress.stems.map((s) => (
          <span key={s.name} className={`stem-chip ${s.state}`}>
            {s.state === "running" && <Loader2 size={11} className="spin" />}
            {s.state === "done" && <Check size={11} />}
            {s.state === "skipped" && <Minus size={11} />}
            {s.state === "failed" && <AlertTriangle size={11} />}
            {STEM_LABELS[s.name]}
            {s.state === "running" && s.pct > 0 ? ` ${Math.round(s.pct * 100)}%` : ""}
          </span>
        ))}
      </span>
    </span>
  );
}

interface Props {
  onImport: (result: ConvertResult) => void;
}

export function Converter({ onImport }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxVoices, setMaxVoices] = useState(DEFAULT_CONVERT_VOICES);
  const [audioBpm, setAudioBpm] = useState(120);
  const [audioInstrument, setAudioInstrument] = useState("l");
  const [fullMix, setFullMix] = useState(false);
  const [autoBpm, setAutoBpm] = useState(true);
  const [stemProgress, setStemProgress] = useState<FullMixProgress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [unoptimize, setUnoptimize] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    setError(null);
    let text = pasteText;
    const extraWarnings: string[] = [];
    if (unoptimize) {
      const expanded = unoptimizeLuting(text);
      text = expanded.output;
      // "no macros" chatter isn't useful on import; keep real warnings only
      extraWarnings.push(...expanded.warnings.filter((w) => !w.startsWith("No macros")));
    }
    const result = importLuting(text);
    onImport({
      bpm: result.bpm,
      voices: result.voices.map((v) => ({ ...v, noteCount: 0 })),
      warnings: [...result.warnings, ...extraWarnings],
    });
    if (result.voices.length > 0) setPasteText("");
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 4));
      const isMidi =
        /\.midi?$/i.test(file.name) ||
        (head[0] === 0x4d && head[1] === 0x54 && head[2] === 0x68 && head[3] === 0x64); // "MThd"
      let result: ConvertResult;
      if (isMidi) {
        result = await convertMidi(buf, maxVoices);
      } else if (fullMix) {
        // heavy ML pipeline — loaded on demand so the main bundle stays lean
        const { convertAudioFullMix } = await import("../lib/stems/fullMix");
        result = await convertAudioFullMix(buf, { bpm: audioBpm, autoBpm, onProgress: setStemProgress });
      } else {
        result = await convertAudio(buf, { bpm: audioBpm, instrument: audioInstrument, autoBpm });
      }
      if (!isMidi && autoBpm && result.voices.length > 0) {
        // reflect the detected tempo back into the field
        setAudioBpm(Math.round(result.bpm / 4));
      }
      onImport(result);
      if (result.voices.length === 0) {
        setError("Nothing convertible was found in that file.");
      }
    } catch (err) {
      setError(`Conversion failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setStemProgress(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };

  return (
    <section className="converter">
      <div
        className={`dropzone ${dragOver ? "drag-over" : ""} ${busy ? "busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
      >
        <input ref={fileInput} type="file" accept=".mid,.midi,audio/*" hidden onChange={onPick} />
        {busy ? (
          stemProgress ? (
            <StemProgress progress={stemProgress} />
          ) : (
            <span>
              <Loader2 size={15} className="spin" /> Converting…
            </span>
          )
        ) : (
          <span>
            <FileMusic size={15} /> Drop a <strong>MIDI</strong> or <strong>MP3</strong> file here
            (or click to browse) — it will be converted to a luting and loaded onto the board
          </span>
        )}
      </div>

      <label
        className="convert-check stem-toggle"
        data-tip="Split a full song into instruments with AI and transcribe each onto the board. Heavy: one-time 131 MB model download, then minutes of in-browser processing."
      >
        <span className="switch">
          <input
            type="checkbox"
            checked={fullMix}
            disabled={busy}
            onChange={(e) => setFullMix(e.target.checked)}
          />
          <span className="switch-slider" />
        </span>
        <Sparkles size={14} />
        Full-mix instrument detection
      </label>
      {fullMix && (
        <div className="stem-warning">
          <img className="stem-warning-img" src={dumbUrl} alt="" />
          <div>
            <div className="stem-warning-title">Slop Mode Activated</div>
            Dropped audio will be split into instruments (drums, bass, guitar, piano, vocals,
            other) and each one transcribed onto the board. The first use downloads a{" "}
            <strong>131&nbsp;MB</strong> model, cached for next time. Everything runs locally in
            your browser: expect <strong>several minutes</strong> of heavy CPU use and high memory
            on a full song. The tempo is detected automatically (untick "auto-detect" to set it
            by hand) — and treat the result as a starting point, not a faithful cover.
          </div>
        </div>
      )}

      <div className="paste-row">
        <textarea
          className="paste-input"
          rows={1}
          spellCheck={false}
          placeholder="…or paste an existing luting here, e.g. #lute 400 ilt4ccggaag8ffeeddc8|ibo2cc"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handlePaste();
            }
          }}
        />
        <button className="btn" onClick={handlePaste} disabled={!pasteText.trim()}>
          <Import size={14} />
          Import
        </button>
      </div>
      <label
        className="convert-check"
        data-tip="Expand macros to plain notes on import — unlocks the visual editors. Untick to keep the luting exactly as pasted."
      >
        <input type="checkbox" checked={unoptimize} onChange={(e) => setUnoptimize(e.target.checked)} />
        Unoptimize on import (expand macros)
      </label>

      <div className="convert-options">
        <label>
          MIDI max voices
          <NumberInput value={maxVoices} onChange={setMaxVoices} min={1} max={MAX_CONVERT_VOICES} ariaLabel="MIDI max voices" />
        </label>
        <label>
          MP3 song BPM
          <NumberInput value={audioBpm} onChange={setAudioBpm} min={20} max={300} ariaLabel="MP3 song BPM" disabled={autoBpm} />
        </label>
        <label
          className="convert-check"
          data-tip="Estimate the tempo from the audio itself (needs a steady pulse). Untick to type the BPM by hand."
        >
          <input type="checkbox" checked={autoBpm} onChange={(e) => setAutoBpm(e.target.checked)} />
          auto-detect
        </label>
        {!fullMix && (
          <label>
            MP3 instrument
            <select value={audioInstrument} onChange={(e) => setAudioInstrument(e.target.value)}>
              {INSTRUMENTS.filter((i) => i.code !== "d").map((i) => (
                <option key={i.code} value={i.code}>
                  {i.icon} {i.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="convert-note">
          {fullMix
            ? "Full-mix mode maps stems to instruments automatically: drums → Drumkit, bass → Bass, guitar → Lute, piano → Keyboard. Vocals and anything else are matched to an instrument by their sound — swap any voice's instrument on the board afterwards."
            : "MP3 conversion detects a single melody line — it works best on clean, monophonic audio (whistling, humming, one instrument). MIDI conversion is accurate."}
        </span>
      </div>

      {error && <div className="warning error">{error}</div>}
    </section>
  );
}
