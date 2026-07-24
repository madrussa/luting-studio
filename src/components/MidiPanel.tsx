import { useEffect, useRef, useState } from 'react'
import { KeyboardMusic, CircleDot, Square, X, Keyboard, Unplug } from 'lucide-react'
import { INSTRUMENTS, instrumentByCode } from '../lib/luting'
import {
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
import { ensureLiveAudio, liveNoteOn, liveNoteOff, stopAllLive, startMetronome, stopMetronome } from '../lib/liveSynth'
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
  // a dot that blinks when a key is pressed, as a "signal is arriving" check
  const [pulse, setPulse] = useState(0)

  const instrumentRef = useRef(instrument)
  instrumentRef.current = instrument
  const recorderRef = useRef<MidiRecorder | null>(null)
  // a pending count-in-delayed overdub playback start, so stop can cancel it
  const overdubTimerRef = useRef<number | null>(null)

  // one subscription for the panel's lifetime: live-play every event, and
  // feed the recorder when a take is running
  useEffect(() => {
    if (!activated) return
    const unsubNotes = subscribeMidiNotes((ev) => {
      const ins = instrumentRef.current
      if (ev.kind === 'on') {
        liveNoteOn(ins, ev.midi, ev.velocity)
        setPulse((p) => p + 1)
      } else {
        liveNoteOff(ins, ev.midi)
      }
      const rec = recorderRef.current
      if (rec) {
        if (ev.kind === 'on') rec.noteOn(ev.midi, ev.velocity, ev.timeMs)
        else rec.noteOff(ev.midi, ev.timeMs)
        setNoteCount(rec.noteCount())
      }
    })
    const unsubDevices = subscribeMidiDevices(() => setDevices(getMidiDevices()))
    return () => {
      unsubNotes()
      unsubDevices()
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

  const connect = () => {
    setError(null)
    ensureLiveAudio() // needs this click's user gesture
    setActivated(true)
    setOpen(true)
    if (isMidiSupported()) {
      // don't block the panel on the permission prompt
      enableMidi()
        .then(() => setDevices(getMidiDevices()))
        .catch((e) => setError(e instanceof Error ? e.message : 'MIDI access was denied.'))
    } else {
      setError('This browser has no Web MIDI — hardware needs Chrome or Edge. The on-screen keyboard still works.')
    }
  }

  const toggleSim = () => {
    const next = !simOn
    setSimOn(next)
    setSimActive(next)
    setDevices(getMidiDevices())
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
        <KeyboardMusic size={15} className={pulse % 2 ? 'midi-pulse-a' : 'midi-pulse-b'} />
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
