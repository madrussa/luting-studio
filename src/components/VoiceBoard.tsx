import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction, DragEvent } from 'react'
import { PianoRoll } from './PianoRoll'
import { VoiceStrip } from './VoiceStrip'
import { parseLuting } from '../lib/luting'
import type { ParseResult } from '../lib/luting'
import { GripVertical, Piano, Volume2, VolumeX, Play, Square, X, ChevronUp, ChevronDown } from 'lucide-react'
import { transposeBody, locateNoteAt } from '../lib/transform'
import Editor from 'react-simple-code-editor'
import { highlightLuting } from '../lib/lutingLang'
import type { VoiceUI } from '../App'
import { newVoiceId } from '../App'
import { INSTRUMENTS, instrumentByCode } from '../lib/luting'
import { playLuting, stopPlayback, getPlaybackInfo } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'
import { INSTRUMENT_MIME } from './InstrumentPalette'
import { NumberInput } from './NumberInput'
import { useBackdropClose } from '../lib/useBackdropClose'
import { KEYS } from '../lib/keys'
import { useRollView } from '../lib/rollView'

const VOICE_MIME = 'application/x-luting-voice'

interface Props {
  voices: VoiceUI[]
  setVoices: Dispatch<SetStateAction<VoiceUI[]>>
  bpm: number
  setBpm: (bpm: number) => void
  showSyntax: boolean
  songKey: string
  setSongKey: (k: string) => void
}

export function VoiceBoard({ voices, setVoices, bpm, setBpm, showSyntax, songKey, setSongKey }: Props) {
  // the key only affects notation input, so it's only shown in staff view
  const staffView = useRollView().mode === 'staff'
  const listRef = useRef<HTMLDivElement>(null)
  // live drop indicator while dragging over the list: either an insertion gap
  // (index) or an instrument-swap onto an existing voice (swapId)
  const [drop, setDrop] = useState<{ index: number; swapId: string | null } | null>(null)
  // id of the voice awaiting a remove confirmation, or null when the dialog is closed
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmVoice = voices.find((v) => v.id === confirmId) ?? null
  const confirmBackdrop = useBackdropClose(() => setConfirmId(null))

  const update = (id: string, patch: Partial<VoiceUI>) =>
    setVoices((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))

  const remove = (id: string) => setVoices((vs) => vs.filter((v) => v.id !== id))

  const confirmRemove = () => {
    if (confirmId) remove(confirmId)
    setConfirmId(null)
  }

  // Esc cancels the remove dialog, Enter confirms it.
  useEffect(() => {
    if (!confirmId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmId(null)
      else if (e.key === 'Enter') confirmRemove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmId])

  const addVoiceAt = (instrument: string, index: number) => {
    const name = instrumentByCode(instrument)?.name ?? 'Voice'
    setVoices((vs) => {
      const next = [...vs]
      next.splice(index, 0, { id: newVoiceId(), instrument, body: '', label: name })
      return next
    })
  }

  const moveVoice = (fromId: string, toIndex: number) =>
    setVoices((vs) => {
      const from = vs.findIndex((v) => v.id === fromId)
      if (from === -1) return vs
      const next = [...vs]
      const [moved] = next.splice(from, 1)
      next.splice(toIndex > from ? toIndex - 1 : toIndex, 0, moved)
      return next
    })

  // The full luting (all voices, muted included) keeps voice indexes stable
  // for solo playback and the per-voice editor, and lets cross-voice macros
  // (a real luteboi pattern) resolve.
  const fullLuting = useMemo(
    () => `#lute ${bpm} ` + voices.map((v) => `i${v.instrument}${v.body.replace(/\s+/g, '')}`).join('|'),
    [bpm, voices]
  )
  // parsed once and shared by every card's strip and editor
  const parsed = useMemo(() => parseLuting(fullLuting), [fullLuting])
  // song length in grid units, shared so all open editors stay aligned
  const totalUnits = useMemo(
    () => Math.max(64, Math.ceil(parsed.durationSec / (60 / parsed.bpm)) + 16),
    [parsed]
  )

  const soloVoice = (idx: number, id: string, startAt?: number) => {
    playLuting(fullLuting, { id, soloVoice: idx, startAt })
  }

  // Hot-swap solo playback when the board changes mid-play; stop it if the
  // soloed voice was deleted.
  useEffect(() => {
    const t = setTimeout(() => {
      const info = getPlaybackInfo()
      if (!info || !/^v\d+$/.test(info.id)) return
      const idx = voices.findIndex((v) => v.id === info.id)
      if (idx === -1) stopPlayback()
      else playLuting(fullLuting, { id: info.id, soloVoice: idx, startAt: info.position })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullLuting])

  // Where a drag would land: an instrument over a card's center band swaps that
  // voice's instrument; anywhere else (gaps, card top/bottom edges, empty space)
  // inserts at the nearest gap. Voice (reorder) drags always insert.
  const computeDrop = (clientY: number, isInstrument: boolean): { index: number; swapId: string | null } => {
    const cards = listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>('.voice-card')] : []
    if (isInstrument) {
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect()
        if (clientY < r.top || clientY > r.bottom) continue
        const band = r.height * 0.3 // top/bottom 30% insert, center 40% swaps
        if (clientY > r.top + band && clientY < r.bottom - band) return { index: i, swapId: voices[i].id }
        break
      }
    }
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) {
        index = i
        break
      }
    }
    return { index, swapId: null }
  }

  const onListDragOver = (e: DragEvent) => {
    const types = e.dataTransfer.types
    const isInstrument = types.includes(INSTRUMENT_MIME)
    if (!isInstrument && !types.includes(VOICE_MIME)) return
    e.preventDefault()
    setDrop(computeDrop(e.clientY, isInstrument))
  }

  const onListDragLeave = (e: DragEvent) => {
    if (!listRef.current?.contains(e.relatedTarget as Node | null)) setDrop(null)
  }

  const onListDrop = (e: DragEvent) => {
    e.preventDefault()
    const d = drop
    setDrop(null)
    const ins = e.dataTransfer.getData(INSTRUMENT_MIME)
    const vid = e.dataTransfer.getData(VOICE_MIME)
    if (ins) {
      if (d?.swapId) update(d.swapId, { instrument: ins })
      else addVoiceAt(ins, d ? d.index : voices.length)
    } else if (vid) {
      moveVoice(vid, d ? d.index : voices.length)
    }
  }

  return (
    <section className="board">
      <div className="board-header">
        <div className="panel-title">
          Voices <span className="panel-sub">each plays at the same time, separated by |</span>
        </div>
        <div className="board-controls">
          {staffView && (
            <label className="bpm-control" data-tip="Notation key — flattens the right notes for you in staff view (flat keys only for now). Shift-click overrides.">
              Key
              <select value={songKey} onChange={(e) => setSongKey(e.target.value)} aria-label="Song key">
                {KEYS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="bpm-control" data-tip="tip: 4× your song's BPM, then t4 = quarter notes">
            #lute BPM
            <NumberInput value={bpm} onChange={setBpm} min={1} ariaLabel="Beats per minute" />
          </label>
        </div>
      </div>

      <div
        className={`voice-list ${drop ? 'drag-over' : ''}`}
        ref={listRef}
        onDragOver={onListDragOver}
        onDragLeave={onListDragLeave}
        onDrop={onListDrop}
      >
        {voices.length === 0 && (
          <div className="empty-hint">Drag an instrument here to add a voice 🪕</div>
        )}
        {voices.map((v, idx) => (
          <Fragment key={v.id}>
            {drop && drop.swapId === null && drop.index === idx && <div className="drop-line" />}
            <VoiceCard
              voice={v}
              voiceIndex={idx}
              parsed={parsed}
              totalUnits={totalUnits}
              showSyntax={showSyntax}
              songKey={songKey}
              swapHighlight={drop?.swapId === v.id}
              onSolo={(startAt) => soloVoice(idx, v.id, startAt)}
              onChange={(patch) => update(v.id, patch)}
              onRemove={() => setConfirmId(v.id)}
            />
          </Fragment>
        ))}
        {drop && drop.swapId === null && drop.index === voices.length && <div className="drop-line" />}
      </div>

      {confirmVoice && (
        <div className="modal-backdrop" {...confirmBackdrop}>
          <div className="modal modal-confirm" role="alertdialog" aria-modal="true" aria-label="Remove voice">
            <div className="modal-head">
              <span className="panel-title">Remove voice?</span>
              <button className="icon-btn" aria-label="Cancel" data-tip="Cancel" data-tip-pos="right" onClick={() => setConfirmId(null)}>
                <X size={14} />
              </button>
            </div>
            <p className="confirm-body">
              <strong>{confirmVoice.label?.trim() || 'This voice'}</strong>
              {confirmVoice.body.trim() ? ' and its notes will be deleted.' : ' will be removed.'} This can't be undone.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmId(null)}>
                Cancel
              </button>
              <button className="btn danger" autoFocus onClick={confirmRemove}>
                <X size={14} /> Remove voice
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

interface CardProps {
  voice: VoiceUI
  voiceIndex: number
  parsed: ParseResult
  totalUnits: number
  showSyntax: boolean
  songKey: string
  swapHighlight: boolean
  onSolo: (startAt?: number) => void
  onChange: (patch: Partial<VoiceUI>) => void
  onRemove: () => void
}

function VoiceCard({ voice, voiceIndex, parsed, totalUnits, showSyntax, songKey, swapHighlight, onSolo, onChange, onRemove }: CardProps) {
  const [editing, setEditing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const ins = instrumentByCode(voice.instrument)
  const playing = useActivePlayback() === voice.id
  const voiceNotes = useMemo(
    () => parsed.notes.filter((n) => n.voice === voiceIndex),
    [parsed, voiceIndex]
  )

  // caret position in the syntax box -> spotlighted note in the editor grid
  const highlight = useMemo(
    () => (editing && caret !== null ? locateNoteAt(voice.body, caret) : null),
    [editing, caret, voice.body]
  )
  const updateCaret = (e: { target: EventTarget | null }) => {
    const ta = e.target as HTMLTextAreaElement
    setCaret(typeof ta?.selectionStart === 'number' ? ta.selectionStart : null)
  }

  const warn = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 2500)
  }

  const transpose = (e: React.MouseEvent, dir: 1 | -1) => {
    const semis = dir * (e.shiftKey ? 12 : 1)
    if (voice.instrument === 'd') {
      warn("Drum voices can't be transposed — each pitch is a different drum sound.")
      return
    }
    if (/[@~]/.test(voice.body)) {
      warn("Can't transpose voices with tempo changes (@) or fades (~) yet — edit the text directly.")
      return
    }
    if (voiceNotes.length === 0) return
    const body = transposeBody(voiceNotes, parsed.bpm, semis)
    if (body === null) {
      warn('That shift would push notes outside the playable o1–o7 range.')
      return
    }
    if (/[A-Z]/.test(voice.body)) warn('Macros were expanded to plain notes by the transpose.')
    onChange({ body })
  }

  return (
    <div className={`voice-card ${swapHighlight ? 'drag-over' : ''} ${voice.muted ? 'muted' : ''}`}>
      <div className="voice-head">
        <span
          className="drag-handle"
          data-tip="Drag to reorder"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(VOICE_MIME, voice.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
        >
          <GripVertical size={15} />
        </span>
        <span className="voice-icon">{ins?.icon ?? '🎵'}</span>
        <select
          className="instrument-select"
          value={voice.instrument}
          onChange={(e) => onChange({ instrument: e.target.value })}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i.code} value={i.code}>
              {i.name} (i{i.code})
            </option>
          ))}
        </select>
        <input
          className="voice-label"
          value={voice.label}
          placeholder="voice name"
          onChange={(e) => onChange({ label: e.target.value })}
        />
        {editing && (
          <>
            <button
              className="icon-btn"
              aria-label="Transpose up"
              data-tip="Transpose up a semitone — shift+click for an octave"
              data-tip-pos="right"
              onClick={(e) => transpose(e, 1)}
            >
              <ChevronUp size={14} />
            </button>
            <button
              className="icon-btn"
              aria-label="Transpose down"
              data-tip="Transpose down a semitone — shift+click for an octave"
              data-tip-pos="right"
              onClick={(e) => transpose(e, -1)}
            >
              <ChevronDown size={14} />
            </button>
          </>
        )}
        <button
          className={`icon-btn ${editing ? 'active' : ''}`}
          aria-label="Note editor"
          data-tip={editing ? 'Close the note editor' : 'Edit notes visually'}
          data-tip-pos="right"
          onClick={() => setEditing(!editing)}
        >
          <Piano size={14} />
        </button>
        <button
          className={`icon-btn ${voice.muted ? 'muted-toggle' : ''}`}
          aria-label="Enable or disable voice"
          data-tip={voice.muted ? 'Enable this voice' : 'Disable this voice — drops it from the luting'}
          data-tip-pos="right"
          onClick={() => onChange({ muted: !voice.muted })}
        >
          {voice.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <button
          className={`icon-btn ${playing ? 'active' : ''}`}
          aria-label="Solo"
          data-tip={playing ? 'Stop' : 'Play this voice alone'}
          data-tip-pos="right"
          onClick={() => (playing ? stopPlayback() : onSolo())}
        >
          {playing ? <Square size={12} /> : <Play size={13} />}
        </button>
        <button className="icon-btn danger" aria-label="Remove voice" data-tip="Remove this voice" data-tip-pos="right" onClick={onRemove}>
          <X size={14} />
        </button>
      </div>
      {flash && <div className="roll-note warning">{flash}</div>}
      {!editing && (
        <VoiceStrip
          notes={voiceNotes}
          durationSec={parsed.durationSec}
          voiceId={voice.id}
          instrument={voice.instrument}
          onScrub={(t) => onSolo(t)}
        />
      )}
      {showSyntax && (
        <div className="voice-body-wrap">
          <Editor
            className="code-editor"
            value={voice.body}
            onValueChange={(body) => onChange({ body })}
            highlight={highlightLuting}
            padding={8}
            placeholder="notes, e.g. t4ccggaag8  (a-g notes, ' = flat, r = rest, o4 > < octave, (ceg) chord)"
            onClick={updateCaret}
            onKeyUp={updateCaret}
            onBlur={() => setCaret(null)}
          />
        </div>
      )}
      {editing && (
        <PianoRoll
          notes={voiceNotes}
          bpm={parsed.bpm}
          instrument={voice.instrument}
          body={voice.body}
          totalUnits={totalUnits}
          voiceId={voice.id}
          songKey={songKey}
          highlight={highlight}
          onScrub={(t) => onSolo(t)}
          onChangeBody={(body) => onChange({ body })}
        />
      )}
    </div>
  )
}
