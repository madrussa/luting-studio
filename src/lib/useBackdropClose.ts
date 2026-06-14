import { useRef } from 'react'
import type { MouseEvent } from 'react'

/**
 * Click-to-close handlers for a modal backdrop that ignore clicks whose press
 * began *inside* the dialog. A click event targets the nearest common ancestor
 * of the mousedown and mouseup, so selecting text in the dialog and releasing
 * on the backdrop would otherwise count as a backdrop click and close it.
 * We only close when both the press and the release land on the backdrop.
 *
 * Spread the result onto the backdrop element: `<div {...useBackdropClose(onClose)}>`.
 */
export function useBackdropClose(onClose: () => void) {
  const pressedSelf = useRef(false)
  return {
    onMouseDown: (e: MouseEvent) => {
      pressedSelf.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent) => {
      if (pressedSelf.current && e.target === e.currentTarget) onClose()
    },
  }
}
