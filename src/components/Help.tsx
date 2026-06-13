// Help: a tabbed reference — how the studio works, the luting syntax, and a
// step-by-step tutorial. The Syntax & Tutorial tabs are adapted from the
// luteboi.com reference and tutorial (instrument/drum tables are generated
// from the app's own constants so they stay in sync).

import { useState } from 'react'
import { X } from 'lucide-react'
import { INSTRUMENTS, DRUM_SOUNDS } from '../lib/luting'
import { highlightLuting } from '../lib/lutingLang'

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'studio' | 'syntax' | 'tutorial'

function Key({ k }: { k: string }) {
  return <kbd className="kbd">{k}</kbd>
}

/** A highlighted luting example. */
function Lut({ children }: { children: string }) {
  return <pre className="help-code" dangerouslySetInnerHTML={{ __html: highlightLuting(children) }} />
}

function StudioHelp() {
  return (
    <>
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
          <li><strong>Preview</strong> plays the whole luting; the big timeline at the bottom is scrubbable and lights up the notes as they play. The volume slider (top bar) controls all sounds.</li>
          <li>Edits made <strong>while playing</strong> (instrument swaps, mutes, notes, BPM) hot-swap into the running audio about a beat later.</li>
          <li><Key k="Esc" /> stops any sound, anywhere. The sounds are Web Audio approximations — paste into luteboi.com for the real thing.</li>
        </ul>
      </div>

      <div className="help-section">
        <div className="help-title">Import, optimize, score, share</div>
        <ul className="help-list">
          <li><strong>Import / Convert</strong>: drop a MIDI (accurate, multi-voice, drum mapping) or an MP3 (best-effort, clean single melodies only), or paste any luting — including <strong>multilutes</strong>, which are joined automatically. "Unoptimize on import" expands macros so it's immediately editable.</li>
          <li><strong>Optimize</strong> compresses with macros (often 50–70% smaller) and self-checks that the music is identical. If it's still over the 493-char cheer limit, it offers numbered <strong>multilute messages</strong> to send in order. <strong>Unoptimize</strong> expands macros back to plain notes.</li>
          <li><strong>Score</strong> opens an engraved, read-only view of the whole piece (staves, beams, ties, percussion staff for drums).</li>
          <li><strong>Trim</strong> removes seconds from the start and/or end — click the timeline to pick the cuts, or type them.</li>
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
    </>
  )
}

const DURATIONS: [string, string][] = [
  ['a', 'Note a at the default duration'],
  ["d'3", 'D♭, duration 3 (no need to write 3/1)'],
  ["e'/2", 'E♭, duration ½ (no need to write 1/2)'],
  ['c/2', 'A 32nd note (when BPM = song BPM × 4)'],
  ['c5/2', 'The long 8th of a swing pair'],
  ['c3/2', 'The short 8th of a swing pair'],
]

const SYMBOLS: [string, string][] = [
  ['#lute N', 'Tempo header — N beats per minute (tip: 4× your song’s BPM)'],
  ['#lute m N …', 'A multilute message — several joined in order (the last drops the m)'],
  ['i_', 'Instrument, set once per voice (see the table above)'],
  ['o1–o7', 'Octave; bare o = o4 (middle C). > up an octave, < down'],
  ['t', 'Default note duration, e.g. t4. Any whole number or fraction'],
  ['v / v1–v9', 'Volume: bare v = 100%, v1–v9 = 10–90%'],
  ['s1–s9', 'Panning: s1 hard left, s5 centre, s9 hard right'],
  ['@N / ~', '@ changes tempo mid-voice; ~ before the next @/v fades to it'],
  ['|', 'Separates voices — they all start together'],
  ['( … )', 'Chord, ascending; a duration may follow, e.g. (ceg)4'],
  ['A{…} / A / A4', 'Define / use / repeat a macro (any capital A–Z)'],
  ['// … //', 'Comment (stripped before playing)'],
]

const DEFAULTS: [string, string][] = [
  ['Instrument', 'il — Lute'],
  ['Octave', 'o4 — middle C'],
  ['Default duration', 't1 — sixteenths'],
  ['Volume', 'v — full'],
  ['Panning', 's5 — centre'],
]

function SyntaxRef() {
  return (
    <>
      <div className="help-section">
        <div className="help-title">Shape of a luting</div>
        <p className="help-p">
          A luting starts with a tempo header, then one or more voices separated by <code>|</code>. Each
          voice sets its instrument and other parameters, then lists notes:
        </p>
        <Lut>{'#lute 400 ilo4t4v ccggaag8ffeeddc8 | ibo2 cgcg'}</Lut>
        <p className="help-p">
          In Luting Studio you rarely type all of this — the palette, BPM box, and editors write it for you —
          but it helps to recognise the pieces.
        </p>
      </div>

      <div className="help-section">
        <div className="help-title">Notes</div>
        <ul className="help-list">
          <li>Notes are <code>a b c d e f g</code> (always lowercase); <code>r</code> is a rest.</li>
          <li>A trailing <code>'</code> makes a note <strong>flat</strong>: <code>c' d' e' f' g' a' b'</code>. (There is no sharp — <code>d'</code> is C♯.)</li>
          <li>A number after a note sets its duration; otherwise it uses the voice's <code>t</code> default.</li>
        </ul>
        <table className="help-table">
          <thead><tr><th>Notation</th><th>Meaning</th></tr></thead>
          <tbody>
            {DURATIONS.map(([n, d]) => (
              <tr key={n}><td><code>{n}</code></td><td>{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="help-section">
        <div className="help-title">Settings &amp; symbols</div>
        <table className="help-table">
          <tbody>
            {SYMBOLS.map(([s, d]) => (
              <tr key={s}><td><code>{s}</code></td><td>{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="help-section">
        <div className="help-title">Instruments</div>
        <table className="help-table">
          <thead><tr><th>Instrument</th><th>Code</th></tr></thead>
          <tbody>
            {INSTRUMENTS.map((i) => (
              <tr key={i.code}>
                <td>{i.icon} {i.name}</td>
                <td><code>i{i.code}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="help-section">
        <div className="help-title">Drumkit</div>
        <p className="help-p">
          With the Drumkit (<code>id</code>), specific note+octave combinations make specific sounds:
        </p>
        <table className="help-table">
          <thead><tr><th>Note</th><th>Sound</th></tr></thead>
          <tbody>
            {Object.values(DRUM_SOUNDS).map((d) => (
              <tr key={d.key}><td><code>{d.key}</code></td><td>{d.name}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="help-section">
        <div className="help-title">Per-voice defaults</div>
        <p className="help-p">When a voice begins, parameters you don't set take these defaults:</p>
        <table className="help-table">
          <tbody>
            {DEFAULTS.map(([s, d]) => (
              <tr key={s}><td>{s}</td><td><code>{d}</code></td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="credits-foot">
        Syntax reference adapted from{' '}
        <a href="https://luteboi.com/" target="_blank" rel="noreferrer">luteboi.com</a> and the{' '}
        <a href="https://github.com/AnAnnoyingCat/lutingsyntax" target="_blank" rel="noreferrer">lutingsyntax</a> grammar.
      </div>
    </>
  )
}

function Tutorial() {
  return (
    <>
      <div className="help-section">
        <div className="help-title">1 · Tempo</div>
        <p className="help-p">
          Every luting opens with a tempo header, <code>#lute BPM</code>. It's recommended to pick a BPM
          equal to <strong>four times</strong> your song's real tempo — then <code>t1</code> is a sixteenth
          note, <code>t2</code> an eighth, <code>t4</code> a quarter, and so on.
        </p>
        <p className="help-p">
          Within a voice, <code>@</code> changes the tempo on the fly, and <code>~</code> before the next
          tempo fades into it:
        </p>
        <Lut>{'#lute 400 ceg@800ceg'}</Lut>
      </div>

      <div className="help-section">
        <div className="help-title">2 · Voice settings</div>
        <p className="help-p">
          Before its notes, a voice can set its instrument, octave, default duration, volume and panning.
          Building up "Twinkle, Twinkle" on a Lute at middle C in quarter notes:
        </p>
        <Lut>{'#lute 400 ilo4t4vs5'}</Lut>
        <ul className="help-list">
          <li><strong>Instrument</strong> <code>i_</code> — set once, can't change within the voice (e.g. <code>il</code> = Lute).</li>
          <li><strong>Octave</strong> <code>o</code> — <code>o1</code>–<code>o7</code>; bare <code>o</code> = 4. <code>&gt;</code> up, <code>&lt;</code> down, any time.</li>
          <li><strong>Default duration</strong> <code>t</code> — applies to notes without their own number.</li>
          <li><strong>Volume</strong> <code>v</code> — bare = 100%, <code>v1</code>–<code>v9</code> = 10–90%. Fade with <code>~</code>.</li>
          <li><strong>Panning</strong> <code>s1</code>–<code>s9</code> — left to right, <code>s5</code> centre.</li>
        </ul>
        <p className="help-p">
          Everything has a default (Lute, o4, t1, full volume, centre), so the same tune is just:
        </p>
        <Lut>{'#lute 400 t4ccggaag8ffeeddc8'}</Lut>
      </div>

      <div className="help-section">
        <div className="help-title">3 · Notes &amp; fractions</div>
        <p className="help-p">
          A note is a letter <code>a</code>–<code>g</code> (or <code>r</code> for a rest), an optional
          <code>'</code> for flat, and an optional duration. Durations can be fractions <code>a/b</code> —
          omit either side and it's assumed to be 1, so <code>c/2</code> is a 32nd note and <code>c5/2</code>
          is the long half of a swing pair.
        </p>
        <Lut>{"#lute 400 t4 cc ggaa g8 ffee dd c8"}</Lut>
      </div>

      <div className="help-section">
        <div className="help-title">4 · Drumkit</div>
        <p className="help-p">
          The Drumkit (<code>id</code>) maps note+octave to a drum sound (full table in the Syntax tab):
          <code>o0a</code> kick, <code>o3c</code> snare, <code>o4c</code> closed hat, and so on.
        </p>
        <Lut>{'#lute 400 id o0ao3co0ao3c'}</Lut>
      </div>

      <div className="help-section">
        <div className="help-title">5 · Macros</div>
        <p className="help-p">
          Repeated sections can be named with a capital letter to save characters. Define inside
          <code>{'{ }'}</code>; a number after the closing brace (or after a later reference) repeats it. To
          play <code>ababababcccabababab</code>:
        </p>
        <Lut>{'A{ab}4cccA4'}</Lut>
        <p className="help-p">
          This defines <code>A</code> = "ab", plays it 4×, then references it 4× again. Luting Studio's
          <strong> Optimize</strong> button does this for you, and <strong>Unoptimize</strong> expands it back.
        </p>
      </div>

      <div className="help-section">
        <div className="help-title">6 · Chords</div>
        <p className="help-p">
          Notes in round brackets play together. Chords ascend automatically, so <code>(cecece)</code> is
          c-e in o4, o5 and o6 at once — no <code>&gt;</code> needed. A duration can follow the bracket.
        </p>
        <Lut>{'#lute 400 ik (ceg)2 (df a)2'}</Lut>
      </div>

      <div className="help-section">
        <div className="help-title">7 · Multiple voices</div>
        <p className="help-p">
          Separate simultaneous voices with <code>|</code>; they all start at the same instant. In the
          studio each voice is a card, but it's the same thing under the hood:
        </p>
        <Lut>{'#lute 400 ilt4ceg | ibo2t4cc | idv8o0ar3o3c'}</Lut>
      </div>

      <div className="help-section">
        <div className="help-title">8 · Fitting Twitch</div>
        <p className="help-p">
          To cheer on Twitch a message can be at most <strong>493 characters</strong> (after the
          "Cheer1 " prefix). Use <strong>Optimize</strong> to macro-compress; if it's still too long the studio
          splits it into numbered <strong>multilute</strong> messages to send in order.
        </p>
      </div>

      <div className="credits-foot">
        Tutorial adapted from the luteboi.com tutorial by{' '}
        <a href="https://luteboi.com/" target="_blank" rel="noreferrer">LuteBoi</a>.
      </div>
    </>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'studio', label: 'Studio Help' },
  { id: 'syntax', label: 'Syntax' },
  { id: 'tutorial', label: 'Tutorial' },
]

export function Help({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('studio')
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-wide modal-help" role="dialog" aria-modal="true" aria-label="Help">
        <div className="modal-head">
          <span className="panel-title">Help</span>
          <button className="icon-btn" aria-label="Close" data-tip="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="help-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`help-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="help-tab-body">
          {tab === 'studio' && <StudioHelp />}
          {tab === 'syntax' && <SyntaxRef />}
          {tab === 'tutorial' && <Tutorial />}
        </div>
      </div>
    </div>
  )
}
