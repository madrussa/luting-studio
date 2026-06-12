import { INSTRUMENTS } from '../lib/luting'
import { previewInstrument } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'

export const INSTRUMENT_MIME = 'application/x-luting-instrument'

export function InstrumentPalette() {
  const activeId = useActivePlayback()
  return (
    <aside className="palette">
      <div className="panel-title">
        Instruments
        <span className="panel-sub">drag onto the board · click to hear</span>
      </div>
      <div className="palette-grid">
        {INSTRUMENTS.map((ins) => (
          <button
            key={ins.code}
            className={`chip ${activeId === `instrument:${ins.code}` ? 'playing' : ''}`}
            data-tip={`i${ins.code} — ${ins.hint}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(INSTRUMENT_MIME, ins.code)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => previewInstrument(ins.code)}
          >
            <span className="chip-icon">{ins.icon}</span>
            <span className="chip-name">{ins.name}</span>
            <span className="chip-code">i{ins.code}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
