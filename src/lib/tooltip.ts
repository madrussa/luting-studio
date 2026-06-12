// One global tooltip for every [data-tip] element. A single fixed-position
// bubble escapes scroll-container clipping and is clamped to the viewport.

export function installTooltips() {
  const tip = document.createElement('div')
  tip.className = 'app-tooltip'
  document.body.appendChild(tip)

  let showTimer = 0
  let current: HTMLElement | null = null

  const hide = () => {
    clearTimeout(showTimer)
    tip.classList.remove('show')
    current = null
  }

  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null
    if (el === current) return
    hide()
    if (!el) return
    current = el
    showTimer = window.setTimeout(() => {
      const text = el.getAttribute('data-tip')
      if (!text || !el.isConnected) return
      tip.textContent = text
      tip.classList.add('show')
      const r = el.getBoundingClientRect()
      const tw = tip.offsetWidth
      const th = tip.offsetHeight
      let x = r.left + r.width / 2 - tw / 2
      x = Math.max(8, Math.min(x, innerWidth - tw - 8))
      let y = r.bottom + 8
      if (y + th > innerHeight - 8) y = r.top - th - 8
      tip.style.left = `${x}px`
      tip.style.top = `${y}px`
    }, 350)
  })
  document.addEventListener('mousedown', hide)
  document.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)
}
