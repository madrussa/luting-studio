// Help: what everything does, including the controls you can't see.

import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

function Key({ k }: { k: string }) {
  return <kbd className="kbd">{k}</kbd>
}

export function Help({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Help">
        <div className="modal-head">
          <span className="panel-title">Help</span>
          <button className="icon-btn" aria-label="Close" data-tip="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="help-section">
          <div className="help-title">The board</div>
          <ul className="help-list">
            <li><strong>Drag an instrument</strong> from the palette onto the board to add a voice; drop it <strong>onto an existing voice</strong> to swap its instrument. Click a palette chip to hear it.</li>
            <li>Voices play simultaneously, joined with <code>|</code> in the output. Drag the grip handle to reorder them — careful with reordering if voices share macros.</li>
            <li>Each card: <strong>solo play</strong>, <strong>mute</strong> (drops the voice from the luting entirely — handy for trimming toward the Twitch limit), <strong>note editor</strong>, and <strong>remove</strong>. The name field is free text.</li>
            <li>The thin strip under each header is that voice's timeline — <strong>click or drag it to solo-play from that point</strong>.</li>
          </ul>
        </div>

        <div className="help-section">
          <div className="help-title">The note editor (piano roll)</div>
          <ul className="help-list">
            <li><strong>Click an empty cell</strong> to add a note at the selected length; <strong>click a note</strong> to remove it. Stack notes in the same column to build chords. Drumkit voices show one row per drum sound.</li>
            <li>If you read music, switch the editor to <strong>staff view</strong> (the toolbar toggle) — a grand staff with clefs, ledger lines and accidentals. Click a line or space to add a note; <Key k="Shift" />+click writes it as a <strong>flat</strong>. The view choice is shared by all editors.</li>
            <li><Key k="Ctrl" />/<Key k="⌘" /> + <strong>mouse wheel</strong> (or trackpad pinch) zooms, anchored at the cursor. Zoom and horizontal scroll are <strong>shared across all open editors</strong> so voices stay aligned; <strong>Fit</strong> shows the whole track.</li>
            <li>Drag the <strong>bar-number ruler</strong> to scrub solo playback; the playhead sweeps the grid and notes flash as they sound.</li>
            <li>With the editor open, <strong>placing the caret on a note in the syntax box spotlights it in the grid</strong> (and scrolls to it) — great for finding your place in long voices.</li>
            <li>While the editor is open, <strong>▲ / ▼ transpose</strong> the voice a semitone — <Key k="Shift" />+click for a full octave.</li>
            <li>Caveats: editing a macro'd voice expands it to plain notes; voices with tempo changes (<code>@</code>) or fades (<code>~</code>) can only be edited as text; one luting voice can't overlap notes except as same-length chords.</li>
          </ul>
        </div>

        <div className="help-section">
          <div className="help-title">Playback</div>
          <ul className="help-list">
            <li><strong>Preview</strong> plays the whole luting; the big timeline at the bottom is scrubbable and lights up the notes as they play.</li>
            <li>Edits made <strong>while playing</strong> (instrument swaps, mutes, notes, BPM) hot-swap into the running audio about a beat later.</li>
            <li><Key k="Esc" /> stops any sound, anywhere. The sounds are Web Audio approximations — paste into luteboi.com for the real thing.</li>
          </ul>
        </div>

        <div className="help-section">
          <div className="help-title">Import, optimize, share</div>
          <ul className="help-list">
            <li><strong>Import / Convert</strong>: drop a MIDI (accurate, multi-voice, drum mapping) or an MP3 (best-effort, clean single melodies only), or paste any luting — including <strong>multilutes</strong>, which are joined automatically.</li>
            <li><strong>Optimize</strong> compresses with macros (often 50–70% smaller) and self-checks that the music is identical. If it's still over the 493-char cheer limit, it offers numbered <strong>multilute messages</strong> to send in order. <strong>Unoptimize</strong> expands macros back to plain notes.</li>
            <li><strong>Trim</strong> removes N seconds from the start and/or end of the whole song, keeping every voice aligned (notes overlapping the cut are clipped).</li>
            <li>The syntax boxes are live in both directions — type luting syntax or use the editor, they're the same data. <strong>Hide syntax</strong> collapses every card to a compact mixer view.</li>
          </ul>
        </div>

        <div className="help-section">
          <div className="help-title">Library &amp; saving</div>
          <ul className="help-list">
            <li>The working board auto-saves in this browser. The <strong>Library</strong> stores named songs durably — save, save copies, load, delete (click the trash twice).</li>
            <li><Key k="Ctrl" />/<Key k="⌘" /> + <Key k="S" /> quick-saves the open song from anywhere.</li>
          </ul>
        </div>

        <div className="help-section">
          <div className="help-title">All shortcuts</div>
          <ul className="help-list">
            <li><Key k="Esc" /> — stop playback / close dialogs</li>
            <li><Key k="Ctrl" />/<Key k="⌘" /> + <Key k="S" /> — save to library</li>
            <li><Key k="Ctrl" />/<Key k="⌘" /> + wheel — zoom editors (over an editor)</li>
            <li><Key k="Shift" /> + click ▲/▼ — transpose an octave</li>
            <li><Key k="Enter" /> in the paste box — import</li>
          </ul>
        </div>

        <div className="credits-foot">
          New to the syntax itself? The full luting tutorial lives on{' '}
          <a href="https://luteboi.com/" target="_blank" rel="noreferrer">
            luteboi.com
          </a>{' '}
          under "Tutorial".
        </div>
      </div>
    </div>
  )
}
