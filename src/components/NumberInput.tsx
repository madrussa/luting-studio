// A number field with themed up/down steppers (the native browser spinner is
// hidden) and optional scroll-to-adjust. Clamps to [min, max] and snaps to the
// step's decimal precision, so it's a drop-in for the app's plain number inputs.

import { useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

interface Props {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** scroll over the field to nudge it by one step (default true) */
  wheel?: boolean
  className?: string
  inputClassName?: string
  ariaLabel?: string
  tip?: string
  tipPos?: string
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  wheel = true,
  className,
  inputClassName,
  ariaLabel,
  tip,
  tipPos,
}: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const decimals = (String(step).split('.')[1] || '').length

  const clamp = (n: number) => {
    if (Number.isNaN(n)) return min ?? 0
    let v = n
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    return Number(v.toFixed(decimals))
  }
  const nudge = (dir: 1 | -1) => onChange(clamp(value + dir * step))

  // wheel needs a non-passive listener so the page/scroll container doesn't
  // move instead of the value
  useEffect(() => {
    const el = ref.current
    if (!el || disabled || !wheel) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      onChange(clamp(value + (e.deltaY < 0 ? step : -step)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, wheel, value, step, min, max])

  const atMin = min != null && value <= min
  const atMax = max != null && value >= max

  return (
    <span className={`num-input${disabled ? ' disabled' : ''}${className ? ' ' + className : ''}`} data-tip={tip} data-tip-pos={tipPos}>
      <input
        ref={ref}
        type="number"
        className={inputClassName}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(clamp(e.target.valueAsNumber))}
      />
      <span className="num-steppers">
        <button type="button" tabIndex={-1} className="num-step" aria-label="Increase" disabled={disabled || atMax} onClick={() => nudge(1)}>
          <ChevronUp size={11} />
        </button>
        <button type="button" tabIndex={-1} className="num-step" aria-label="Decrease" disabled={disabled || atMin} onClick={() => nudge(-1)}>
          <ChevronDown size={11} />
        </button>
      </span>
    </span>
  )
}
