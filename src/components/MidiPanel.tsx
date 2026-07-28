import { useEffect, useRef, useState } from 'react'
import { KeyboardMusic, CircleDot, Square, X, Keyboard, Unplug } from 'lucide-react'
import { INSTRUMENTS, instrumentByCode } from '../lib/luting'
import {
  MIDI_UNSUPPORTED,
  isMidiSupported,
  enableMidi,
  getMidiInput,
  setMidiInput,
  subscribeMidiNotes,
  subscribeMidiDevices,
  getMidiDevices,
  setSimActive,
  disableMidi,
} from '../lib/midi'
import type { MidiDevice } from '../lib/midi'
import {
  ensureLiveAudio,
  liveNoteOn,
  liveNoteOff,
  stopAllLive,
  stopLiveForDevice,
  startMetronome,
  stopMetronome,
} from '../lib/liveSynth'
import { getPlaybackMode, subscribePlaybackMode, loadBank } from '../lib/samples'
import { playLuting, stopPlayback, getActivePlaybackId } from '../lib/player'
import { createMidiRecorder } from '../lib/midiRecord'
import type { MidiRecorder, RecordResult } from '../lib/midiRecord'
import { SimKeyboard } from './SimKeyboard'

interface Props {
  bpm: number
  /** the current board's luting, for overdub playback */
  luting: string
  onRecorded: (result: RecordResult) => void
}

/** How long a device request may run before the panel explains the wait. */
const SLOW_MS = 2500

/**
 * Topbar MIDI control: connect a hardware keyboard (Web MIDI) or the
 * on-screen simulator, play the luteboi voices live, and record takes onto
 * the board. Once enabled, input stays live even with the panel closed.
 */
export function MidiPanel({ bpm, luting, onRecorded }: Props) {
  const [open, setOpen] = useState(false)
  // the panel has been switched on (audio context is live); hardware access
  // may still be pending, denied, or unsupported — the simulator works anyway
  const [activated, setActivated] = useState(false)
  const [devices, setDevices] = useState<MidiDevice[]>([])
  const [input, setInput] = useState(getMidiInput())
  const [instrument, setInstrument] = useState('l')
  const [simOn, setSimOn] = useState(false)
  const [recording, setRecording] = useState(false)
  const [metroOn, setMetroOn] = useState(false)
  const [overdubOn, setOverdubOn] = useState(false)
  const [noteCount, setNoteCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // a device request that has run long enough to be worth explaining
  const [pending, setPending] = useState(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const instrumentRef = useRef(instrument)
  instrumentRef.current = instrument
  const recorderRef = useRef<MidiRecorder | null>(null)
  // a pending count-in-delayed overdub playback start, so stop can cancel it
  const overdubTimerRef = useRef<number | null>(null)
  // devices as of the last refresh, to spot ones that have gone away
  const knownRef = useRef<MidiDevice[]>([])

  // MIDI messages are delivered on the main thread, so the note path must not
  // trigger React work per event — a re-render per key press (worse with the
  // on-screen keyboard mounted, worse again with several ports feeding in) is
  // rendering time stolen from the messages queued behind it. The blink is a
  // direct class swap and the note tally is batched.
  const iconRef = useRef<SVGSVGElement | null>(null)
  const blinkFlip = useRef(false)
  const blink = () => {
    const el = iconRef.current
    if (!el) return
    blinkFlip.current = !blinkFlip.current
    // alternating one-shot animations: removing the old class restarts it
    el.classList.remove(blinkFlip.current ? 'midi-pulse-b' : 'midi-pulse-a')
    el.classList.add(blinkFlip.current ? 'midi-pulse-a' : 'midi-pulse-b')
  }

  const liveCountRef = useRef(0)
  const countFlushRef = useRef<number | null>(null)
  const flushCount = () => {
    if (countFlushRef.current !== null) return
    countFlushRef.current = window.setTimeout(() => {
      countFlushRef.current = null
      setNoteCount(liveCountRef.current)
    }, 120)
  }

  /** re-read the device list, releasing notes held by anything unplugged */
  const refreshDevices = () => {
    const next = getMidiDevices()
    const present = new Set(next.map((d) => d.id))
    for (const d of knownRef.current) {
      if (!present.has(d.id)) stopLiveForDevice(d.id) // no note-offs are coming
    }
    // don't leave the filter pointed at a device that's gone, or nothing plays
    const selected = getMidiInput()
    if (selected !== 'all' && !present.has(selected)) {
      setMidiInput('all')
      setInput('all')
    }
    knownRef.current = next
    setDevices(next)
  }

  // one subscription for the panel's lifetime: live-play every event, and
  // feed the recorder when a take is running
  useEffect(() => {
    if (!activated) return
    const unsubNotes = subscribeMidiNotes((ev) => {
      const ins = instrumentRef.current
      if (ev.kind === 'on') {
        liveNoteOn(ins, ev.midi, ev.velocity, ev.deviceId)
        blink()
      } else {
        liveNoteOff(ins, ev.midi, ev.deviceId)
      }
      const rec = recorderRef.current
      if (rec) {
        if (ev.kind === 'on') rec.noteOn(ev.midi, ev.velocity, ev.timeMs, ev.deviceId)
        else rec.noteOff(ev.midi, ev.timeMs, ev.deviceId)
        liveCountRef.current = rec.noteCount()
        flushCount()
      }
    })
    const unsubDevices = subscribeMidiDevices(refreshDevices)
    return () => {
      unsubNotes()
      unsubDevices()
      if (countFlushRef.current !== null) window.clearTimeout(countFlushRef.current)
    }
  }, [activated])

  // switching the live instrument releases held notes so none get orphaned
  // under the old instrument's key
  useEffect(() => stopAllLive(), [instrument])

  // keep the live voice's sample pack warm in Quality mode, so the first
  // key press plays the real sample instead of the synth fallback
  useEffect(() => {
    if (!activated) return
    const warm = () => {
      if (getPlaybackMode() === 'quality') void loadBank(instrument)
    }
    warm()
    return subscribePlaybackMode(warm)
  }, [activated, instrument])

  useEffect(() => () => clearTimeout(pendingTimer.current), [])

  const connect = () => {
    setError(null)
    ensureLiveAudio() // needs this click's user gesture
    setActivated(true)
    setOpen(true)
    if (isMidiSupported()) {
      // Don't block the panel on the permission prompt — the simulator and the
      // voices are usable while the browser makes up its mind. It can take a
      // while: Firefox sits on a refusal for a random 3-13 seconds (see
      // midi.ts), so say so rather than leaving an empty device list to explain
      // itself.
      pendingTimer.current = setTimeout(() => setPending(true), SLOW_MS)
      const settled = () => {
        clearTimeout(pendingTimer.current)
        setPending(false)
      }
      enableMidi()
        .then(() => {
          settled()
          refreshDevices()
        })
        .catch((e) => {
          settled()
          setError(e instanceof Error ? e.message : 'MIDI access was denied.')
        })
    } else {
      setError(`${MIDI_UNSUPPORTED} The on-screen keyboard still works.`)
    }
  }

  const toggleSim = () => {
    const next = !simOn
    setSimOn(next)
    setSimActive(next)
    refreshDevices()
  }

  // Fully let go of the browser's device access (clears the "site is using
  // MIDI/USB devices" indicator). A running take is finished first, never lost.
  const disconnect = () => {
    if (recorderRef.current) toggleRecord()
    stopMetronome()
    stopOverdub()
    stopAllLive()
    setSimOn(false)
    setSimActive(false)
    disableMidi()
    knownRef.current = []
    setDevices([])
    setError(null)
    setActivated(false)
    setOpen(false)
  }

  const stopOverdub = () => {
    if (overdubTimerRef.current !== null) {
      window.clearTimeout(overdubTimerRef.current)
      overdubTimerRef.current = null
    }
    if (getActivePlaybackId() === 'overdub') stopPlayback()
  }

  const toggleRecord = () => {
    if (recorderRef.current) {
      stopMetronome()
      stopOverdub()
      const result = recorderRef.current.finish(performance.now())
      recorderRef.current = null
      if (countFlushRef.current !== null) {
        window.clearTimeout(countFlushRef.current)
        countFlushRef.current = null
      }
      setRecording(false)
      onRecorded(result)
    } else {
      // metronome: a 1-bar count-in whose end is the recording's grid zero
      let anchorMs = metroOn ? startMetronome(bpm, 4).anchorMs : undefined
      // overdub: play the song and align the grid to its start, so the take
      // lands at the right song position (leading rests included)
      if (overdubOn && luting) {
        const startPlayback = () => {
          overdubTimerRef.current = null
          playLuting(luting, { id: 'overdub' })
        }
        const PLAY_LATENCY_MS = 80 // playLuting's own scheduling headroom
        if (anchorMs !== undefined) {
          overdubTimerRef.current = window.setTimeout(
            startPlayback,
            Math.max(0, anchorMs - performance.now() - PLAY_LATENCY_MS)
          )
        } else {
          startPlayback()
          anchorMs = performance.now() + PLAY_LATENCY_MS
        }
      }
      recorderRef.current = createMidiRecorder(bpm, instrument, { anchorMs })
      liveCountRef.current = 0
      setNoteCount(0)
      setRecording(true)
    }
  }

  const unitMs = Math.round(60000 / Math.max(1, bpm))
  const hardwareCount = devices.filter((d) => d.id !== 'simulator').length

  return (
    <div className="midi-wrap">
      <button
        className={`btn ${recording ? 'midi-recording' : open ? 'active-btn' : ''}`}
        data-tip={
          activated
            ? 'MIDI input is live — click for devices & recording'
            : 'Play & record the voices with a MIDI keyboard (or the on-screen one)'
        }
        onClick={() => (activated ? setOpen(!open) : connect())}
      >
        {/* no className here: the blink is applied via classList off the MIDI
            thread, and a React-managed className would fight it */}
        <KeyboardMusic size={15} ref={iconRef} />
        MIDI
      </button>

      {open && (
        <div className="midi-pop" role="dialog" aria-label="MIDI keyboard">
          <div className="midi-pop-head">
            <span className="panel-title">MIDI keyboard</span>
            <button className="icon-btn" aria-label="Close" data-tip="Close — the keyboard stays live" data-tip-pos="right" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>

          {error && <div className="midi-error">{error}</div>}
          {pending && (
            <div className="midi-hint">
              Waiting on the browser for device access. Firefox takes its time about this, and
              refuses outright if the controller isn't plugged in yet.
            </div>
          )}

          {activated && (
            <>
              <label className="midi-row">
                Device
                <select value={input} onChange={(e) => { setInput(e.target.value); setMidiInput(e.target.value) }} aria-label="MIDI input device">
                  <option value="all">All devices</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {hardwareCount === 0 && !simOn && (
                <div className="midi-hint">No MIDI devices found — plug one in, or use the on-screen keyboard below.</div>
              )}

              <label className="midi-row">
                Voice
                <select value={instrument} onChange={(e) => setInstrument(e.target.value)} aria-label="Live instrument">
                  {INSTRUMENTS.map((i) => (
                    <option key={i.code} value={i.code}>
                      {i.icon} {i.name} (i{i.code})
                    </option>
                  ))}
                </select>
              </label>

              <button className={`btn ${simOn ? 'active-btn' : ''}`} onClick={toggleSim}>
                <Keyboard size={14} />
                {simOn ? 'Hide on-screen keyboard' : 'On-screen keyboard'}
              </button>

              <label className="midi-row midi-check" data-tip="A 4-click count-in, then a bar-accented click. The grid locks to the count-in instead of your first note.">
                <input type="checkbox" checked={metroOn} disabled={recording} onChange={(e) => setMetroOn(e.target.checked)} />
                Metronome + 1-bar count-in
              </label>
              <label className="midi-row midi-check" data-tip="Overdub: the board's song plays while you record, and the take lands aligned to it.">
                <input type="checkbox" checked={overdubOn} disabled={recording || !luting} onChange={(e) => setOverdubOn(e.target.checked)} />
                Play the song while recording
              </label>

              <button className={`btn ${recording ? 'midi-recording' : ''}`} onClick={toggleRecord}>
                {recording ? <Square size={14} /> : <CircleDot size={14} />}
                {recording ? `Stop — add to board (${noteCount} note${noteCount === 1 ? '' : 's'})` : 'Record a take'}
              </button>

              <div className="midi-hint">
                {recording
                  ? metroOn
                    ? 'Recording began after the count-in — notes land where you hear them.'
                    : 'The take starts on your first note. Notes quantize to the grid below.'
                  : `Play to hear the ${instrumentByCode(instrument)?.name ?? 'voice'} live. Recording adds new voices to the board.`}
                <br />
                Grid: 1 unit = {unitMs}ms (#lute {bpm}).
              </div>

              <button className="btn midi-disconnect" onClick={disconnect}>
                <Unplug size={14} />
                Disconnect
              </button>
            </>
          )}
        </div>
      )}

      {simOn && activated && <SimKeyboard instrument={instrument} onClose={toggleSim} />}
    </div>
  )
}
