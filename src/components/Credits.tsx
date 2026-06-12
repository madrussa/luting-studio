// Credits: the people and projects this app is built on.

import { ExternalLink, X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

interface Credit {
  name: string
  what: string
  url: string
}

const LUTING_CREDITS: Credit[] = [
  {
    name: 'LuteBoi',
    what: 'The luting platform itself — the syntax, the instruments, and the real sound. This app is a companion tool; lutings are made to be played there.',
    url: 'https://luteboi.com/',
  },
  {
    name: 'AnAnnoyingCat / lutingsyntax',
    what: 'The luting VS Code extension. Source of the syntax grammar our highlighting is migrated from, the optimizer concepts, and the multilute message format.',
    url: 'https://github.com/AnAnnoyingCat/lutingsyntax',
  },
]

const SOFTWARE_CREDITS: Credit[] = [
  {
    name: '@tonejs/midi',
    what: 'MIDI file parsing for the MIDI → luting converter.',
    url: 'https://github.com/Tonejs/Midi',
  },
  {
    name: 'VexFlow',
    what: 'Music engraving for the Score view — staves, beams, ties, and the percussion staff.',
    url: 'https://vexflow.com/',
  },
  {
    name: 'Prism.js',
    what: 'Syntax highlighting engine running the migrated luting grammar.',
    url: 'https://prismjs.com/',
  },
  {
    name: 'react-simple-code-editor',
    what: 'The editable highlighted syntax boxes.',
    url: 'https://github.com/react-simple-code-editor/react-simple-code-editor',
  },
  {
    name: 'Lucide',
    what: 'The flat icon set used across the UI.',
    url: 'https://lucide.dev/',
  },
  {
    name: 'React',
    what: 'UI framework.',
    url: 'https://react.dev/',
  },
  {
    name: 'Vite',
    what: 'Build tool and dev server.',
    url: 'https://vitejs.dev/',
  },
]

function CreditList({ title, credits }: { title: string; credits: Credit[] }) {
  return (
    <div className="credits-section">
      <div className="credits-title">{title}</div>
      {credits.map((c) => (
        <a key={c.name} className="credit-row" href={c.url} target="_blank" rel="noreferrer">
          <span className="credit-name">
            {c.name} <ExternalLink size={11} />
          </span>
          <span className="credit-what">{c.what}</span>
        </a>
      ))}
    </div>
  )
}

export function Credits({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Credits">
        <div className="modal-head">
          <span className="panel-title">Credits</span>
          <button className="icon-btn" aria-label="Close" data-tip="Close" data-tip-pos="right" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <CreditList title="Luting & syntax" credits={LUTING_CREDITS} />
        <CreditList title="Software" credits={SOFTWARE_CREDITS} />
        <div className="credits-foot">
          The in-app instrument sounds are Web Audio approximations — all credit for the real instruments
          belongs to LuteBoi.
        </div>
      </div>
    </div>
  )
}
