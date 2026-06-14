import { useState } from 'react'
import { Loader2, Undo2, Redo2 } from 'lucide-react'
import { INSTRUMENTS } from '../lib/luting'
import { previewInstrument } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'
import { getPlaybackMode, getBank } from '../lib/samples'

export const INSTRUMENT_MIME = 'application/x-luting-instrument'

interface Props {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  undoCount: number
  redoCount: number
}

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`

export function InstrumentPalette({ undo, redo, canUndo, canRedo, undoCount, redoCount }: Props) {
  const activeId = useActivePlayback()
  const [loadingCode, setLoadingCode] = useState<string | null>(null)

  const handleClick = (code: string) => {
    // In Quality mode, a not-yet-loaded pack downloads before it plays —
    // show a spinner on the chip until the audition starts.
    const needsLoad = getPlaybackMode() === 'quality' && !getBank(code) && activeId !== `instrument:${code}`
    const done = previewInstrument(code)
    if (needsLoad) {
      setLoadingCode(code)
      done.finally(() => setLoadingCode((c) => (c === code ? null : c)))
    }
  }

  return (
    <aside className="palette">
      <div className="history-controls">
        <button
          className="icon-btn"
          aria-label="Undo"
          data-tip={canUndo ? `Undo ${steps(undoCount)} — Ctrl/⌘+Z` : 'Undo — Ctrl/⌘+Z'}
          data-tip-pos="right"
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-btn"
          aria-label="Redo"
          data-tip={canRedo ? `Redo ${steps(redoCount)} — Ctrl/⌘+Shift+Z` : 'Redo — Ctrl/⌘+Shift+Z'}
          data-tip-pos="right"
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 size={15} />
        </button>
      </div>
      <div className="panel-title">
        Instruments
        <span className="panel-sub">drag onto the board · click to hear</span>
      </div>
      <div className="palette-grid">
        {INSTRUMENTS.map((ins) => (
          <button
            key={ins.code}
            className={`chip ${activeId === `instrument:${ins.code}` ? 'playing' : ''} ${
              loadingCode === ins.code ? 'loading' : ''
            }`}
            data-tip={`i${ins.code} — ${ins.hint}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(INSTRUMENT_MIME, ins.code)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => handleClick(ins.code)}
          >
            {loadingCode === ins.code && <Loader2 size={15} className="chip-spinner spin" />}
            <span className="chip-icon">{ins.icon}</span>
            <span className="chip-name">{ins.name}</span>
            <span className="chip-code">i{ins.code}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
