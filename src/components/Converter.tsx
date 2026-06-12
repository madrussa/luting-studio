import { useRef, useState } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { convertMidi } from "../lib/convert";
import type { ConvertResult } from "../lib/convert";
import { convertAudio } from "../lib/pitch";
import { INSTRUMENTS, importLuting } from "../lib/luting";
import { FileMusic, Loader2, Import } from "lucide-react";

interface Props {
  onImport: (result: ConvertResult) => void;
}

export function Converter({ onImport }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxVoices, setMaxVoices] = useState(20);
  const [audioBpm, setAudioBpm] = useState(120);
  const [audioInstrument, setAudioInstrument] = useState("l");
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    setError(null);
    const result = importLuting(pasteText);
    onImport({
      bpm: result.bpm,
      voices: result.voices.map((v) => ({ ...v, noteCount: 0 })),
      warnings: result.warnings,
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
      const result = isMidi
        ? await convertMidi(buf, maxVoices)
        : await convertAudio(buf, { bpm: audioBpm, instrument: audioInstrument });
      onImport(result);
      if (result.voices.length === 0) {
        setError("Nothing convertible was found in that file.");
      }
    } catch (err) {
      setError(`Conversion failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
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
          <span>
            <Loader2 size={15} className="spin" /> Converting…
          </span>
        ) : (
          <span>
            <FileMusic size={15} /> Drop a <strong>MIDI</strong> or <strong>MP3</strong> file here
            (or click to browse) — it will be converted to a luting and loaded onto the board
          </span>
        )}
      </div>

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

      <div className="convert-options">
        <label>
          MIDI max voices
          <input
            type="number"
            min={1}
            max={24}
            value={maxVoices}
            onChange={(e) =>
              setMaxVoices(Math.min(24, Math.max(1, parseInt(e.target.value, 10) || 1)))
            }
          />
        </label>
        <label>
          MP3 song BPM
          <input
            type="number"
            min={20}
            max={300}
            value={audioBpm}
            onChange={(e) =>
              setAudioBpm(Math.min(300, Math.max(20, parseInt(e.target.value, 10) || 120)))
            }
          />
        </label>
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
        <span className="convert-note">
          MP3 conversion detects a single melody line — it works best on clean, monophonic audio
          (whistling, humming, one instrument). MIDI conversion is accurate.
        </span>
      </div>

      {error && <div className="warning error">{error}</div>}
    </section>
  );
}
