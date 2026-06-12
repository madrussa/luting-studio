import { useEffect, useMemo, useState } from 'react'
import { parseLuting, TWITCH_LIMIT } from '../lib/luting'
import { highlightLuting } from '../lib/lutingLang'
import { optimizeLuting, unoptimizeLuting, toMultilute } from '../lib/optimize'
import type { OptimizeResult } from '../lib/optimize'
import { playLuting, stopPlayback } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'
import { Timeline } from './Timeline'
import type { Lane } from './Timeline'
import {
  Play,
  Square,
  Copy,
  Check,
  Sparkles,
  Loader2,
  ExternalLink,
  ArrowUpToLine,
  Clock,
  TriangleAlert,
  UnfoldHorizontal,
} from 'lucide-react'

interface Props {
  luting: string
  lanes: Lane[]
  onLoadLuting: (text: string) => void
}

export function OutputPanel({ luting, lanes, onLoadLuting }: Props) {
  const [copied, setCopied] = useState(false)
  const [opt, setOpt] = useState<(OptimizeResult & { mode: 'optimize' | 'expand' }) | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optCopied, setOptCopied] = useState(false)
  const [copiedPart, setCopiedPart] = useState<number | null>(null)
  const activeId = useActivePlayback()
  const playing = activeId === 'main'
  const optPlaying = activeId === 'optimized'

  useEffect(() => setOpt(null), [luting])

  const runOptimize = (mode: 'optimize' | 'expand') => {
    setOptimizing(true)
    // let the button repaint before the synchronous crunch
    setTimeout(() => {
      try {
        const result = mode === 'optimize' ? optimizeLuting(luting) : unoptimizeLuting(luting)
        setOpt({ ...result, mode })
      } finally {
        setOptimizing(false)
      }
    }, 30)
  }

  const parsed = useMemo(() => (luting ? parseLuting(luting) : null), [luting])
  const chars = luting.length
  const overLimit = chars > TWITCH_LIMIT

  useEffect(() => () => stopPlayback(), [])

  const togglePlay = () => {
    if (playing) {
      stopPlayback()
    } else if (luting) {
      playLuting(luting, { id: 'main' })
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(luting)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="output">
      <div className="output-header">
        <div className="panel-title">Your luting</div>
        <div className="output-actions">
          <span className={`char-count ${overLimit ? 'over' : ''}`}>
            {chars} chars{' '}
            {overLimit
              ? `(over the ${TWITCH_LIMIT} Twitch cheer limit — try luteboi's optimizer)`
              : `(fits the ${TWITCH_LIMIT} Twitch cheer limit)`}
          </span>
          {parsed && parsed.durationSec > 0 && (
            <span className="duration">
              <Clock size={12} /> {parsed.durationSec.toFixed(1)}s
            </span>
          )}
          <button className="btn" onClick={togglePlay} disabled={!luting}>
            {playing ? <Square size={14} /> : <Play size={14} />}
            {playing ? 'Stop' : 'Preview'}
          </button>
          <button className="btn" onClick={copy} disabled={!luting}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn" onClick={() => runOptimize('optimize')} disabled={!luting || optimizing}>
            {optimizing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {optimizing ? 'Optimizing…' : 'Optimize'}
          </button>
          <button
            className="btn"
            data-tip="Expand all macros back to plain notes — unlocks visual editing on macro'd voices"
            onClick={() => runOptimize('expand')}
            disabled={!luting || optimizing}
          >
            <UnfoldHorizontal size={14} />
            Unoptimize
          </button>
          <a className="btn primary" href="https://luteboi.com/" target="_blank" rel="noreferrer">
            Open luteboi.com <ExternalLink size={14} />
          </a>
        </div>
      </div>
      <Timeline luting={luting} lanes={lanes} />

      <pre className="output-text code-view" dangerouslySetInnerHTML={{ __html: highlightLuting(luting) }} />

      {opt && (
        <div className="opt-result">
          <div className="output-header">
            <span className="opt-stats">
              {opt.mode === 'expand' && opt.after !== opt.before ? (
                <>
                  <UnfoldHorizontal size={13} /> {opt.before} → <strong>{opt.after}</strong> chars — macros
                  expanded to plain notes
                </>
              ) : opt.after < opt.before ? (
                <>
                  <Sparkles size={13} /> {opt.before} → <strong>{opt.after}</strong> chars (−
                  {Math.round((1 - opt.after / opt.before) * 100)}%, {opt.macrosUsed} macros)
                  {opt.after <= TWITCH_LIMIT && opt.before > TWITCH_LIMIT && ' — now fits Twitch!'}
                </>
              ) : (
                <>{opt.mode === 'expand' ? 'No macros to expand.' : 'No savings found — output unchanged.'}</>
              )}
            </span>
            <div className="output-actions">
              <button
                className="btn"
                onClick={() => {
                  if (optPlaying) stopPlayback()
                  else playLuting(opt.output, { id: 'optimized' })
                }}
              >
                {optPlaying ? <Square size={14} /> : <Play size={14} />}
                {optPlaying ? 'Stop' : 'Preview'}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await navigator.clipboard.writeText(opt.output)
                  setOptCopied(true)
                  setTimeout(() => setOptCopied(false), 1500)
                }}
              >
                {optCopied ? <Check size={14} /> : <Copy size={14} />}
                {optCopied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn" onClick={() => onLoadLuting(opt.output)}>
                <ArrowUpToLine size={14} />
                Load to board
              </button>
            </div>
          </div>
          {opt.after !== opt.before && (
            <pre
              className="output-text code-view"
              dangerouslySetInnerHTML={{ __html: highlightLuting(opt.output) }}
            />
          )}
          {opt.output.length > TWITCH_LIMIT && (
            <div className="multilute">
              <div className="multilute-head">
                Still over one cheer — as a multilute ({toMultilute(opt.output).length} messages, send
                in order):
                <button
                  className="btn small"
                  onClick={async () => {
                    await navigator.clipboard.writeText(toMultilute(opt.output).join('\n\n'))
                    setCopiedPart(-1)
                    setTimeout(() => setCopiedPart(null), 1500)
                  }}
                >
                  {copiedPart === -1 ? <Check size={13} /> : <Copy size={13} />}
                  {copiedPart === -1 ? 'Copied' : 'Copy all'}
                </button>
              </div>
              {toMultilute(opt.output).map((part, i) => (
                <div key={i} className="multilute-part">
                  <span className="multilute-num">
                    {i + 1} · {part.length} chars
                  </span>
                  <input className="multilute-text" readOnly value={part} />
                  <button
                    className="btn small"
                    onClick={async () => {
                      await navigator.clipboard.writeText(part)
                      setCopiedPart(i)
                      setTimeout(() => setCopiedPart(null), 1500)
                    }}
                  >
                    {copiedPart === i ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              ))}
            </div>
          )}
          {opt.warnings.map((w, i) => (
            <div key={i} className="warning">
              <TriangleAlert size={13} /> {w}
            </div>
          ))}
        </div>
      )}

      <div className="output-foot">
        Preview uses a built-in approximation of the instruments — paste into luteboi.com and hit
        Generate for the real sound.
        {parsed && parsed.warnings.length > 0 && (
          <span className="warning inline">
            {' '}
            <TriangleAlert size={12} /> {parsed.warnings.join(' · ')}
          </span>
        )}
      </div>
    </section>
  )
}
