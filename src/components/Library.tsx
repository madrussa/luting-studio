// Song library: save the current board under a name, browse saved lutings,
// load or delete them.

import { useEffect, useState } from 'react'
import { listSongs, saveSong, deleteSong, newSongId } from '../lib/library'
import type { SavedSong } from '../lib/library'
import type { VoiceUI } from '../App'
import { parseLuting, instrumentByCode } from '../lib/luting'
import { Save, FolderOpen, Trash2, Copy, X, Music2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  bpm: number
  voices: VoiceUI[]
  luting: string
  songName: string
  currentSongId: string | null
  onSaved: (id: string, name: string) => void
  onLoad: (song: SavedSong) => void
}

const fmtWhen = (ts: number): string => {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function Library({ open, onClose, bpm, voices, luting, songName, currentSongId, onSaved, onLoad }: Props) {
  const [songs, setSongs] = useState<SavedSong[]>([])
  const [name, setName] = useState(songName)
  const [deleteArm, setDeleteArm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(songName || 'Untitled luting')
    setDeleteArm(null)
    listSongs().then(setSongs).catch((e) => setError(`Could not open the library: ${e}`))
  }, [open, songName])

  if (!open) return null

  const buildSong = (id: string, saveName: string): SavedSong => ({
    id,
    name: saveName.trim() || 'Untitled luting',
    bpm,
    voices: voices.map((v) => ({ ...v })),
    updatedAt: Date.now(),
    chars: luting.length,
    voiceCount: voices.filter((v) => !v.muted && v.body.trim() !== '').length,
    durationSec: luting ? parseLuting(luting).durationSec : 0,
  })

  const save = async (asCopy: boolean) => {
    setError(null)
    try {
      const id = asCopy || !currentSongId ? newSongId() : currentSongId
      const song = buildSong(id, name)
      await saveSong(song)
      onSaved(id, song.name)
      setSongs(await listSongs())
    } catch (e) {
      setError(`Save failed: ${e}`)
    }
  }

  const remove = async (id: string) => {
    if (deleteArm !== id) {
      setDeleteArm(id)
      setTimeout(() => setDeleteArm((cur) => (cur === id ? null : cur)), 2500)
      return
    }
    setDeleteArm(null)
    await deleteSong(id)
    setSongs(await listSongs())
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Song library">
        <div className="modal-head">
          <span className="panel-title">Library</span>
          <button className="icon-btn" aria-label="Close" data-tip="Close" data-tip-pos="right" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="lib-save-row">
          <input
            className="lib-name-input"
            value={name}
            placeholder="song name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save(false)}
          />
          <button className="btn primary" onClick={() => save(false)}>
            <Save size={14} />
            {currentSongId ? 'Save' : 'Save to library'}
          </button>
          {currentSongId && (
            <button className="btn" data-tip="Save as a separate copy in the library" onClick={() => save(true)}>
              <Copy size={14} />
              Save copy
            </button>
          )}
        </div>
        <div className="lib-hint">Loading a song replaces the current board — save your work first.</div>
        {error && <div className="warning error">{error}</div>}

        <div className="lib-list">
          {songs.length === 0 && <div className="lib-empty">No saved lutings yet — name the current board above and save it.</div>}
          {songs.map((s) => (
            <div key={s.id} className={`lib-row ${s.id === currentSongId ? 'current' : ''}`}>
              <span className="lib-icons">
                {[...new Set(s.voices.map((v) => v.instrument))].slice(0, 5).map((c, i) => (
                  <span key={i}>{instrumentByCode(c)?.icon ?? <Music2 size={12} />}</span>
                ))}
              </span>
              <span className="lib-name">
                {s.name}
                {s.id === currentSongId && <span className="lib-current-tag"> · open</span>}
              </span>
              <span className="lib-meta">
                {s.voiceCount} voices · {s.chars} chars · {s.durationSec.toFixed(0)}s · {fmtWhen(s.updatedAt)}
              </span>
              <button className="btn small" onClick={() => onLoad(s)}>
                <FolderOpen size={13} />
                Load
              </button>
              <button
                className={`icon-btn ${deleteArm === s.id ? 'danger-armed' : 'danger'}`}
                aria-label="Delete"
                data-tip={deleteArm === s.id ? 'Click again to confirm deletion' : 'Delete this song'}
                data-tip-pos="right"
                onClick={() => remove(s.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
