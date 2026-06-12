// Prism language for luting syntax, migrated from the lutingsyntax VS Code
// extension's TextMate grammar (github.com/AnAnnoyingCat/lutingsyntax,
// syntaxes/lutingSyntax.json), with @tempo and ~fades added (the grammar
// predates them).

import Prism from 'prismjs'

const FRACTION = /(?:\d+\/\d+|\d+|\/\d+)/.source

Prism.languages.luting = {
  comment: {
    pattern: /\/\/[^/\n]*(?:\/\/)?/,
    greedy: true,
  },
  header: /#lute ?m? ?\d*/,
  instrument: /i\w/,
  'macro-def': /[A-Z]\{/, // start-definition
  'macro-end': /\}\d*/, // end-definition
  macro: /[A-Z]\d*/, // predefined-section
  tempo: new RegExp(`@\\d*|~`),
  time: new RegExp(`t${FRACTION}?`),
  octave: /o\d?|[<>]/,
  volume: /v\d?/,
  pan: /s\d/,
  note: new RegExp(`[a-g]'?(?:${FRACTION})?|r(?:${FRACTION})?`),
  chord: /[()]/,
  voice: /\|/,
  number: new RegExp(FRACTION),
}

export function highlightLuting(code: string): string {
  return Prism.highlight(code, Prism.languages.luting, 'luting')
}
