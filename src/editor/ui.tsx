// Small building blocks the editor's panels share.

import type { ReactNode } from 'react'

export const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
)

/** A drag handle on a panel's edge; `set` gets the pointer's x. */
export function Resizer({ edge, set }: { edge: 'left' | 'right'; set: (x: number) => void }) {
  return (
    <div
      className={`resizer ${edge}`}
      title="Drag to resize"
      // preventDefault: otherwise the drag selects the text it passes over
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(e.clientX)}
    />
  )
}

/** A popup menu at `at`, kept on screen; clicking outside it or on one of its buttons closes it. */
export function Menu({ at, onClose, children }: { at: { x: number; y: number }; onClose: () => void; children: ReactNode }) {
  return (
    <div className="menu-backdrop" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div className="menu" ref={(el) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        el.style.left = `${Math.max(8, Math.min(at.x, innerWidth - r.width - 8))}px`
        el.style.top = `${Math.max(8, Math.min(at.y, innerHeight - r.height - 8))}px`
      }} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
        {children}
      </div>
    </div>
  )
}
