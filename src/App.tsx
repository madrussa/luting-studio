import { useEffect, useMemo, useRef, useState } from 'react'
import { InstrumentPalette } from './components/InstrumentPalette'
import { VoiceBoard } from './components/VoiceBoard'
import { Converter } from './components/Converter'
import { OutputPanel } from './components/OutputPanel'
import type { ConvertResult } from './lib/convert'
import { importLuting, instrumentByCode, serializeVoiceBody } from './lib/luting'
import { scheduledToRollNotes, notesToEvents, dominantVolume } from './lib/transform'
import { stopPlayback, playLuting, getPlaybackInfo, getMasterVolume, setMasterVolume } from './lib/player'
import {
  Music,
  Eye,
  EyeOff,
  Import,
  TriangleAlert,
  X,
  Library as LibraryIcon,
  Check,
  Heart,
  CircleHelp,
  Volume2,
  Volume1,
  VolumeX,
} from 'lucide-react'
import { Library } from './components/Library'
import { Credits } from './components/Credits'
import { Help } from './components/Help'
import { saveSong } from './lib/library'
import type { SavedSong } from './lib/library'
import { parseLuting } from './lib/luting'

export interface VoiceUI {
  id: string
  instrument: string
  body: string
  label: string
  muted?: boolean
}

let nextId = 1
export const newVoiceId = () => `v${nextId++}`

const DEMO: VoiceUI[] = [
  {
    id: newVoiceId(),
    instrument: 'l',
    body: 't4ccggaag8ffeeddc8',
    label: 'Twinkle, Twinkle',
  },
]

const STORAGE_KEY = 'luting-studio-v1'

function loadSaved(): {
  bpm: number
  voices: VoiceUI[]
  showSyntax?: boolean
  songName?: string
  currentSongId?: string | null
} | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (s && typeof s.bpm === 'number' && Array.isArray(s.voices) && s.voices.length > 0) {
      for (const v of s.voices) {
        const n = parseInt(String(v.id).slice(1), 10)
        if (!isNaN(n) && n >= nextId) nextId = n + 1
      }
      return s
    }
  } catch {
    // corrupted save; fall through to the demo
  }
  return null
}

export default function App() {
  const [bpm, setBpm] = useState(() => loadSaved()?.bpm ?? 400)
  const [voices, setVoices] = useState<VoiceUI[]>(() => loadSaved()?.voices ?? DEMO)
  const [importOpen, setImportOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [showSyntax, setShowSyntax] = useState(() => loadSaved()?.showSyntax ?? true)
  const [songName, setSongName] = useState(() => loadSaved()?.songName ?? '')
  const [currentSongId, setCurrentSongId] = useState<string | null>(() => loadSaved()?.currentSongId ?? null)
  const [justSaved, setJustSaved] = useState(false)
  const [volume, setVolume] = useState(() => getMasterVolume())
  const prevVolume = useRef(0.8)

  const changeVolume = (v: number) => {
    setVolume(v)
    setMasterVolume(v)
  }
  const toggleMute = () => {
    if (volume > 0) {
      prevVolume.current = volume
      changeVolume(0)
    } else {
      changeVolume(prevVolume.current || 0.8)
    }
  }

  // ESC stops whatever is playing and closes any dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopPlayback()
        setImportOpen(false)
        setLibraryOpen(false)
        setCreditsOpen(false)
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ bpm, voices, showSyntax, songName, currentSongId }))
      } catch {
        // storage full or unavailable; the board just won't persist
      }
    }, 500)
    return () => clearTimeout(t)
  }, [bpm, voices, showSyntax, songName, currentSongId])
  const [importWarnings, setImportWarnings] = useState<string[]>([])

  const luting = useMemo(() => {
    const parts = voices
      .filter((v) => !v.muted && v.body.trim() !== '')
      .map((v) => `i${v.instrument}${v.body.replace(/\s+/g, '')}`)
    if (parts.length === 0) return ''
    return `#lute ${bpm} ${parts.join('|')}`
  }, [bpm, voices])

  // Hot-swap: if the luting changes while the main preview is playing
  // (instrument switched, voice muted, notes edited...), restart playback in
  // place at the current position so the change is heard immediately.
  useEffect(() => {
    const t = setTimeout(() => {
      const info = getPlaybackInfo()
      if (info?.id === 'main' && luting) {
        playLuting(luting, { id: 'main', startAt: info.position })
      }
    }, 250)
    return () => clearTimeout(t)
  }, [luting])

  const lanes = useMemo(
    () =>
      voices
        .filter((v) => !v.muted && v.body.trim() !== '')
        .map((v) => ({
          icon: instrumentByCode(v.instrument)?.icon ?? '🎵',
          label: v.label || instrumentByCode(v.instrument)?.name || 'Voice',
        })),
    [voices]
  )

  const handleImport = (result: ConvertResult) => {
    setImportWarnings(result.warnings)
    if (result.voices.length === 0) return
    setBpm(result.bpm)
    setVoices(
      result.voices.map((v) => ({
        id: newVoiceId(),
        instrument: v.instrument,
        body: v.body,
        label: v.label,
      }))
    )
    setImportOpen(false)
  }

  const handleLoadLuting = (text: string) => {
    const r = importLuting(text)
    handleImport({ bpm: r.bpm, voices: r.voices.map((v) => ({ ...v, noteCount: 0 })), warnings: r.warnings })
  }

  // Trim: drop the first/last N seconds from every voice (muted ones too),
  // keeping them aligned. Notes straddling the cut are clipped at the end
  // boundary; notes starting before the front cut are dropped.
  const handleTrim = (startSec: number, endSec: number) => {
    const full = `#lute ${bpm} ` + voices.map((v) => `i${v.instrument}${v.body.replace(/\s+/g, '')}`).join('|')
    const bodyOnly = full.slice(5)
    if (/[@~]/.test(bodyOnly)) {
      setImportWarnings(["Can't trim songs with tempo changes (@) or fades (~) yet — edit the text directly."])
      return
    }
    const p = parseLuting(full)
    const cutEnd = p.durationSec - endSec
    if (cutEnd - startSec < 0.01) {
      setImportWarnings(['That trim would remove the whole song.'])
      return
    }
    const notices: string[] = []
    if (/[A-Z]/.test(bodyOnly)) notices.push('Macros were expanded to plain notes by the trim.')
    setVoices(
      voices.map((v, idx) => {
        if (v.body.trim() === '') return v
        const kept = p.notes
          .filter((n) => n.voice === idx && n.timeSec >= startSec - 1e-6 && n.timeSec < cutEnd - 1e-6)
          .map((n) => ({ ...n, durSec: Math.min(n.durSec, cutEnd - n.timeSec), timeSec: n.timeSec - startSec }))
        const body = serializeVoiceBody(notesToEvents(scheduledToRollNotes(kept, p.bpm), v.instrument === 'd'), {
          volume: dominantVolume(kept),
        })
        return { ...v, body }
      })
    )
    setImportWarnings(notices)
  }

  const handleLoadSong = (song: SavedSong) => {
    for (const v of song.voices) {
      const n = parseInt(String(v.id).slice(1), 10)
      if (!isNaN(n) && n >= nextId) nextId = n + 1
    }
    setBpm(song.bpm)
    setVoices(song.voices.map((v) => ({ ...v })))
    setSongName(song.name)
    setCurrentSongId(song.id)
    setLibraryOpen(false)
  }

  const flashSaved = () => {
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }

  // Ctrl/Cmd+S: quick-save the open song, or open the library to name it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 's' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      if (!currentSongId) {
        setLibraryOpen(true)
        return
      }
      void saveSong({
        id: currentSongId,
        name: songName || 'Untitled luting',
        bpm,
        voices: voices.map((v) => ({ ...v })),
        updatedAt: Date.now(),
        chars: luting.length,
        voiceCount: voices.filter((v) => !v.muted && v.body.trim() !== '').length,
        durationSec: luting ? parseLuting(luting).durationSec : 0,
      }).then(flashSaved)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentSongId, songName, bpm, voices, luting])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Music size={24} />
          </span>
          <h1>Luting Studio</h1>
          <span className="tagline">
            compose &amp; convert lutings for{' '}
            <a href="https://luteboi.com/" target="_blank" rel="noreferrer">
              luteboi.com
            </a>
          </span>
          {songName && <span className="song-name">{songName}</span>}
        </div>
        <div className="topbar-actions">
          <div className="volume-control" data-tip="Volume for all sounds — click the icon to mute">
            <button className="icon-btn" aria-label="Mute" onClick={toggleMute}>
              {volume === 0 ? <VolumeX size={15} /> : volume < 0.5 ? <Volume1 size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              aria-label="Volume"
              onChange={(e) => changeVolume(parseInt(e.target.value, 10) / 100)}
            />
          </div>
          <button className="btn" data-tip="How everything works, including the hidden controls" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={15} />
            Help
          </button>
          <button className="btn" data-tip="The projects this app is built on" data-tip-pos="right" onClick={() => setCreditsOpen(true)}>
            <Heart size={15} className="heart" />
            Credits
          </button>
          <button className="btn" onClick={() => setLibraryOpen(true)}>
            {justSaved ? <Check size={15} /> : <LibraryIcon size={15} />}
            {justSaved ? 'Saved' : 'Library'}
          </button>
          <button
            className="btn"
            data-tip={showSyntax ? 'Hide the syntax boxes on every voice' : 'Show the syntax boxes on every voice'}
            data-tip-pos="right"
            onClick={() => setShowSyntax(!showSyntax)}
          >
            {showSyntax ? <EyeOff size={15} /> : <Eye size={15} />}
            {showSyntax ? 'Hide syntax' : 'Show syntax'}
          </button>
          <button className="btn primary" onClick={() => setImportOpen(true)}>
            <Import size={15} />
            Import / Convert
          </button>
        </div>
      </header>

      {importWarnings.length > 0 && (
        <div className="import-banner">
          <div className="import-banner-list">
            {importWarnings.map((w, i) => (
              <div key={i} className="warning">
                <TriangleAlert size={14} /> {w}
              </div>
            ))}
          </div>
          <button className="icon-btn" aria-label="Dismiss" data-tip="Dismiss warnings" data-tip-pos="right" onClick={() => setImportWarnings([])}>
            <X size={14} />
          </button>
        </div>
      )}

      {importOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setImportOpen(false)
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Import or convert">
            <div className="modal-head">
              <span className="panel-title">Import / Convert</span>
              <button className="icon-btn" aria-label="Close" data-tip="Close" data-tip-pos="right" onClick={() => setImportOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <Converter onImport={handleImport} />
          </div>
        </div>
      )}

      <Help open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Credits open={creditsOpen} onClose={() => setCreditsOpen(false)} />

      <Library
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        bpm={bpm}
        voices={voices}
        luting={luting}
        songName={songName}
        currentSongId={currentSongId}
        onSaved={(id, name) => {
          setCurrentSongId(id)
          setSongName(name)
          flashSaved()
        }}
        onLoad={handleLoadSong}
      />

      <div className="workspace">
        <InstrumentPalette />
        <VoiceBoard voices={voices} setVoices={setVoices} bpm={bpm} setBpm={setBpm} showSyntax={showSyntax} />
      </div>

      <OutputPanel luting={luting} lanes={lanes} onLoadLuting={handleLoadLuting} onTrim={handleTrim} />
    </div>
  )
}
