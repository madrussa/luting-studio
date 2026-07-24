import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { simNote } from '../lib/midi'
import { ensureLiveAudio } from '../lib/liveSynth'
import { GM_DRUM } from '../lib/convert'
import { DRUM_SOUNDS } from '../lib/luting'

// Classic DAW computer-key layout: home row = white keys, the row above =
// black keys, starting on the C at the current base octave.
const KEY_BINDS: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16,
}
const BIND_LABEL = new Map(Object.entries(KEY_BINDS).map(([k, v]) => [v, k]))

const SEMIS = 25 // two octaves, C to C
const BLACK_PCS = new Set([1, 3, 6, 8, 10])

/** the luteboi drum a MIDI note lands on when the Drumkit voice is live */
function drumName(midi: number): string | null {
  const p = GM_DRUM[midi]
  if (!p) return null
  return DRUM_SOUNDS[`o${p.octave}${p.letter[0]}`]?.name ?? null
}

interface Props {
  /** the voice being played live — drum mode relabels the keys */
  instrument: string
  onClose: () => void
}

/**
 * A floating two-octave piano that plays through the simulated MIDI device —
 * click/drag the keys or use the computer keyboard (Z/X shift octaves).
 * Everything downstream (live synth, recorder, device filter) treats it
 * exactly like a hardware keyboard.
 */
export function SimKeyboard({ instrument, onClose }: Props) {
  // octave of the leftmost C (C4 = middle C = MIDI 60)
  const [octave, setOctave] = useState(4)
  const [velocity, setVelocity] = useState(0.8)
  const [held, setHeld] = useState<Set<number>>(new Set())

  const heldRef = useRef(held)
  heldRef.current = held
  const velocityRef = useRef(velocity)
  velocityRef.current = velocity

  const baseMidi = (octave + 1) * 12

  const press = (midi: number) => {
    if (heldRef.current.has(midi)) return
    ensureLiveAudio() // a key press is a user gesture, so audio can start here
    simNote('on', midi, velocityRef.current)
    setHeld((s) => new Set(s).add(midi))
  }
  const release = (midi: number) => {
    if (!heldRef.current.has(midi)) return
    simNote('off', midi, 0)
    setHeld((s) => {
      const n = new Set(s)
      n.delete(midi)
      return n
    })
  }
  const releaseAll = () => {
    for (const m of [...heldRef.current]) release(m)
  }

  // drums live around MIDI 36-59; jump there so the kick is under your hand
  useEffect(() => {
    releaseAll()
    setOctave(instrument === 'd' ? 2 : 4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument])

  const shiftOctave = (d: number) => {
    releaseAll() // held keys would otherwise note-off at the new pitch
    setOctave((o) => Math.min(7, Math.max(0, o + d)))
  }

  // computer-keyboard play, active while the strip is open
  useEffect(() => {
    const inText = () => {
      const el = document.activeElement
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || inText()) return
      const k = e.key.toLowerCase()
      if (k === 'z') return shiftOctave(-1)
      if (k === 'x') return shiftOctave(1)
      const off = KEY_BINDS[k]
      if (off === undefined) return
      e.preventDefault()
      press((octave + 1) * 12 + off)
    }
    const onUp = (e: KeyboardEvent) => {
      const off = KEY_BINDS[e.key.toLowerCase()]
      if (off !== undefined) release((octave + 1) * 12 + off)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', releaseAll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [octave])

  // silence anything still sounding when the strip closes
  useEffect(() => releaseAll, []) // eslint-disable-line react-hooks/exhaustive-deps

  // geometry: white keys split the width evenly; black keys straddle the gaps
  const semis = [...Array(SEMIS).keys()]
  const whites = semis.filter((s) => !BLACK_PCS.has(s % 12))
  const whiteW = 100 / whites.length
  const whitesBefore = (s: number) => semis.filter((x) => x < s && !BLACK_PCS.has(x % 12)).length

  const key = (s: number, black: boolean) => {
    const midi = baseMidi + s
    const bind = BIND_LABEL.get(s)
    const drum = instrument === 'd' ? drumName(midi) : null
    const style = black
      ? { left: `calc(${whitesBefore(s) * whiteW}% - 1.6%)`, width: '3.2%' }
      : { left: `${whitesBefore(s) * whiteW}%`, width: `${whiteW}%` }
    return (
      <div
        key={s}
        className={`sim-key ${black ? 'black' : 'white'} ${held.has(midi) ? 'held' : ''} ${drum ? 'has-drum' : ''}`}
        style={style}
        title={drum ?? undefined}
        onPointerDown={(e) => {
          e.preventDefault()
          ;(e.target as HTMLElement).releasePointerCapture(e.pointerId) // let a drag glide across keys
          press(midi)
        }}
        onPointerUp={() => release(midi)}
        onPointerEnter={(e) => {
          if (e.buttons & 1) press(midi)
        }}
        onPointerLeave={() => release(midi)}
      >
        {drum && <span className="sim-drum-dot" />}
        {bind && <span className="sim-key-bind">{bind}</span>}
      </div>
    )
  }

  return (
    <div className="sim-kbd" role="group" aria-label="On-screen MIDI keyboard">
      <div className="sim-kbd-bar">
        <span className="sim-kbd-title">On-screen keyboard</span>
        <span className="sim-kbd-oct">
          <button className="icon-btn" aria-label="Octave down" data-tip="Octave down (Z)" onClick={() => shiftOctave(-1)}>
            <ChevronLeft size={14} />
          </button>
          C{octave}–C{octave + 2}
          <button className="icon-btn" aria-label="Octave up" data-tip="Octave up (X)" onClick={() => shiftOctave(1)}>
            <ChevronRight size={14} />
          </button>
        </span>
        <label className="sim-kbd-vel">
          Velocity
          <input
            type="range"
            min={1}
            max={127}
            value={Math.round(velocity * 127)}
            aria-label="Key velocity"
            onChange={(e) => setVelocity(parseInt(e.target.value, 10) / 127)}
          />
        </label>
        <span className="sim-kbd-hint">play with the mouse or A–; keys{instrument === 'd' ? ' · dots mark drum pads' : ''}</span>
        <button className="icon-btn" aria-label="Close keyboard" data-tip="Close the keyboard" data-tip-pos="right" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="sim-keys">
        {semis.filter((s) => !BLACK_PCS.has(s % 12)).map((s) => key(s, false))}
        {semis.filter((s) => BLACK_PCS.has(s % 12)).map((s) => key(s, true))}
      </div>
    </div>
  )
}
