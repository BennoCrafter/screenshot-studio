import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const typing = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea, select, [contenteditable]')

/**
 * An infinite board: Ctrl/⌘ + scroll or a trackpad pinch zooms at the cursor, scroll pans (Shift + scroll sideways),
 * Ctrl/⌘-drag, Space-drag, middle-drag or dragging empty space pans. ⌘/Ctrl + = − 0 zoom in, out and fit.
 * Children get `--z` (the zoom) so handles can stay the same size on screen. A new `reveal` pans its slide on screen.
 */
export function Board({ children, fitKey, onEmptyClick, reveal }: { children: ReactNode; fitKey: unknown; onEmptyClick?: () => void; reveal?: { slide: string } }) {
  const stage = useRef<HTMLDivElement>(null)
  const board = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const [space, setSpace] = useState(false)
  const pan = useRef<{ x: number; y: number; vx: number; vy: number; empty: boolean } | null>(null)

  const zoomAt = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const s = stage.current!
      const px = cx ?? s.clientWidth / 2, py = cy ?? s.clientHeight / 2
      const z = clamp(v.z * factor, 0.05, 4)
      return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z }
    })

  const fit = () => {
    const s = stage.current!, b = board.current!
    // room below for the selected slide's bar
    const z = clamp(Math.min((s.clientWidth - 96) / b.offsetWidth, (s.clientHeight - 160) / b.offsetHeight), 0.05, 1)
    setView({ z, x: (s.clientWidth - b.offsetWidth * z) / 2, y: (s.clientHeight - b.offsetHeight * z) / 2 - 24 })
  }
  useLayoutEffect(fit, [fitKey])

  useEffect(() => {
    const el = reveal && board.current!.querySelector(`canvas[data-slide="${reveal.slide}"]`)
    if (!el) return
    const r = el.getBoundingClientRect(), s = stage.current!.getBoundingClientRect()
    // the least pan that fits it (left/top edge first when it can't), leaving room below for the slide's bar
    const by = (lo: number, hi: number, from: number, to: number) => (lo < from ? from - lo : hi > to ? Math.max(to - hi, from - lo) : 0)
    const dx = by(r.left, r.right, s.left + 48, s.right - 48), dy = by(r.top, r.bottom, s.top + 32, s.bottom - 80)
    if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }, [reveal])

  useEffect(() => {
    const s = stage.current!
    // non-passive so the page itself never scrolls or browser-zooms
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = s.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-clamp(e.deltaY, -30, 30) * 0.01), e.clientX - r.left, e.clientY - r.top) // one wheel notch ≈ 1.35×, pinches stay smooth
      // Shift + a plain mouse wheel pans sideways (macOS already swaps the axes; elsewhere it may not)
      else if (e.shiftKey && !e.deltaX) setView((v) => ({ ...v, x: v.x - e.deltaY }))
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      if (e.code === 'Space') {
        e.preventDefault()
        setSpace(e.type === 'keydown')
      }
      if (e.key === 'Control' || e.key === 'Meta') setSpace(e.type === 'keydown')
      if (e.type !== 'keydown' || !(e.metaKey || e.ctrlKey)) return
      if (e.key === '=' || e.key === '+') zoomAt(1.25)
      else if (e.key === '-') zoomAt(0.8)
      else if (e.key === '0') fit()
      else return
      e.preventDefault()
    }
    s.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    const release = () => setSpace(false) // keyup is lost when the window loses focus mid-press
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('blur', release)
      s.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  return (
    <div
      ref={stage}
      className={space || pan.current ? 'stage panning' : 'stage'}
      // capture phase, so Space/middle-drag pans even when starting over a slide
      onPointerDownCapture={(e) => {
        const empty = e.target === stage.current || e.target === board.current
        const modifier = e.ctrlKey || e.metaKey
        if (!(space || modifier || e.button === 1 || (empty && e.button === 0))) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, empty: empty && !space && e.button === 0 }
      }}
      onPointerMove={(e) => {
        const p = pan.current
        if (p) setView((v) => ({ ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y }))
      }}
      onPointerUp={(e) => {
        const p = pan.current
        pan.current = null
        // a click (not a drag) on empty board clears the selection
        if (p?.empty && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) onEmptyClick?.()
      }}
      // macOS turns Ctrl-click into a right-click; keep the menu away while panning
      onContextMenu={(e) => e.ctrlKey && e.preventDefault()}
    >
      <div
        ref={board}
        className="board"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, '--z': view.z } as CSSProperties}
      >
        {children}
      </div>
      <div className="zoom-controls">
        <button onClick={() => zoomAt(0.8)} title="Zoom out (⌘−)">−</button>
        <button onClick={() => zoomAt(1 / view.z)} title="Zoom to 100%">{Math.round(view.z * 100)}%</button>
        <button onClick={() => zoomAt(1.25)} title="Zoom in (⌘+)">+</button>
        <button onClick={fit} title="Fit (⌘0)">Fit</button>
      </div>
    </div>
  )
}
