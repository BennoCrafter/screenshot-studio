import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEVICE_BY_ID, restFold } from './devices/models'
import type { DevicePose } from './devices/render3d'
import { loadImage } from './project'
import { accepts, IMAGE_FILES } from './native'
import { shotOf, type Shot } from './elements'
import { drawSlide, layersOf, type Anchor, type Part, type Slide } from './render'

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const snap = (v: number, on: boolean) => (on ? Math.round(v / 15) * 15 : Math.round(v))

const FRONT: Partial<DevicePose> = { yaw: 0, pitch: 0, roll: 0 }
const DEGREES_PER_RADIUS = 75 // a drag across the device's radius turns it this far (as in open-screenshot-generator)
const CORNERS = ['nw', 'ne', 'se', 'sw']
const SNAP_PX = 6 // screen px within which a moved element clicks onto a guide

/** The offset that brings one of `edges` (moved by `m`) onto the nearest of `lines` within `tol`, and that line. */
function snapTo(edges: number[], lines: number[], m: number, tol: number) {
  let best: { by: number; at: number } | null = null
  for (const e of edges) for (const l of lines) {
    const by = l - (e + m)
    if (Math.abs(by) <= tol && (!best || Math.abs(by) < Math.abs(best.by))) best = { by, at: l }
  }
  return best
}

type Grip = 'move' | 'turn' | 'fold' | 'scale' | 'spin' | 'resize' | 'rotate'
type Rect = { x: number; y: number; w: number; h: number }

// Same model as open-screenshot-generator: dragging the device moves it, the round grip
// in its middle turns it like a turntable, a foldable's second grip folds it. Shift snaps to 15°.
// Every other element (texts, shapes, images): drag to move, corners to resize, double-click
// a text to type right on the slide; all but devices get a knob on top to rotate them. Moving snaps
// to the slide's middle and edges and to other elements' middles and edges, like Canva; Alt moves freely.
// Dropping onto another slide moves the elements there. Each element gets a hit area stacked in layer order, so the frontmost wins.
export function SlideCanvas({ slide, size, selected, editing, onPress, onGrab, onMenu, onEdit, onEditText, onRotate, onTransfer, onShot }: {
  slide: Slide
  size: readonly [number, number]
  selected: Part[] // this slide's selected elements
  editing: Part | null
  /** Picks `part` (Shift adds or removes it); returns how to move everything picked, or null if it was let go. */
  onPress: (part: Part, additive: boolean) => ((dx: number, dy: number) => void) | null
  /** Starts resizing `parts`, each in place or, given `about` (slide fractions), spread from that point too;
   * returns how to set their size as a multiple of the size they have now. */
  onGrab: (parts: Part[], about?: { x: number; y: number }) => (ratio: number) => void
  onMenu: (part: Part, x: number, y: number) => void
  onEdit: (part: Part | null) => void
  onEditText: (part: Part, text: string) => void
  /** Turns a text, image or shape to `deg` degrees clockwise. */
  onRotate: (part: Part, deg: number) => void
  /** Moves what's picked here onto slide `to`, which sits (dx, dy) slide sizes away. */
  onTransfer: (to: string, dx: number, dy: number) => void
  /** Changes a device element: its pose or screenshots. */
  onShot: (part: Part, patch: Partial<Shot>) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ grip: Grip; x: number; y: number; start: DevicePose; mover?: (dx: number, dy: number) => void; resizer?: (ratio: number) => void; c?: { x: number; y: number }; part?: Part; deg?: number; snap?: { box: Rect; x: number[]; y: number[] }; parts?: Part[]
    ghost?: { el: HTMLCanvasElement; x: number; y: number } } | null>(null)
  const [anchor, setAnchor] = useState<{ anchors: Record<Part, Anchor>; px: number }>()
  const [live, setLive] = useState<Grip | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const dropOn = useRef<HTMLCanvasElement | null>(null) // another slide being dragged over, highlighted
  /** The other slide under the pointer, if any. */
  const otherSlide = (e: React.PointerEvent) => document.elementsFromPoint(e.clientX, e.clientY)
    .find((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement && !!el.dataset.slide && el !== ref.current) ?? null
  const highlight = (el: HTMLCanvasElement | null) => {
    if (dropOn.current === el) return
    dropOn.current?.classList.remove('drop-target')
    el?.classList.add('drop-target')
    dropOn.current = el
  }
  useEffect(() => {
    const anchors = drawSlide(ref.current!.getContext('2d')!, slide, size[0], size[1], editing ?? undefined)
    setAnchor({ anchors, px: ref.current!.clientWidth / size[0] }) // css px per slide px, for the text editor's font
  }, [slide, size, editing])

  const solo = selected.length === 1 ? selected[0] : null // handles show for a lone pick only
  // the device whose grips show: the lone pick if it's a device
  const devPart = solo && anchor?.anchors[solo]?.dev ? solo : null
  const dev = devPart ? anchor!.anchors[devPart] : undefined
  const pose = shotOf(slide, devPart ?? 'device').device
  const model = DEVICE_BY_ID[pose.model]
  const onDevice = (patch: Partial<DevicePose>) => onShot(devPart!, { device: { ...pose, ...patch } })

  /** The box around `parts` on this slide, in slide px. */
  const bounds = (parts: Part[]): Rect | null => {
    const at = parts.map((p) => anchor?.anchors[p]).filter((a) => !!a)
    if (!at.length) return null
    const x = Math.min(...at.map((a) => a.x)), y = Math.min(...at.map((a) => a.y))
    return { x, y, w: Math.max(...at.map((a) => a.x + a.w)) - x, h: Math.max(...at.map((a) => a.y + a.h)) - y }
  }
  const group = selected.length > 1 ? bounds(selected) : null

  const begin = (e: React.PointerEvent, d: NonNullable<typeof drag.current>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = d
    setLive(d.grip)
  }
  const press = (part: Part) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault() // no text/image selection while dragging
    e.stopPropagation()
    const mover = onPress(part, e.shiftKey)
    if (!mover) return
    // what's being dragged on this slide, and the lines it can click onto
    const parts = selected.includes(part) ? selected : e.shiftKey ? [...selected, part] : [part]
    const box = bounds(parts)
    const others = layersOf(slide).filter((p) => !parts.includes(p)).map((p) => anchor?.anchors[p]).filter((a) => !!a)
    const snap = box ? {
      box,
      x: [0, size[0] / 2, size[0], ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])],
      y: [0, size[1] / 2, size[1], ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])],
    } : undefined
    begin(e, { grip: 'move', x: e.clientX, y: e.clientY, start: pose, mover, snap, parts })
  }
  const start = (grip: Grip, part?: Part) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    begin(e, { grip, x: e.clientX, y: e.clientY, start: pose, part, deg: part ? anchor?.anchors[part]?.rotation : undefined, })
  }
  // a lone element grows from its centre; a group from the centre of the box around it, spreading apart
  const resize = (parts: Part[]) => (e: React.PointerEvent) => {
    const b = bounds(parts)
    if (e.button !== 0 || !b) return
    e.preventDefault()
    e.stopPropagation()
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const about = parts.length > 1 ? { x: c.x / size[0], y: c.y / size[1] } : undefined
    begin(e, { grip: 'resize', x: e.clientX, y: e.clientY, start: pose, c, resizer: onGrab(parts, about) })
  }
  const menu = (part: Part) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selected.includes(part)) onPress(part, false)
    onMenu(part, e.clientX, e.clientY)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !anchor) return
    const r = ref.current!.getBoundingClientRect()
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    const c = dev?.dev ?? { cx: 0, cy: 0, radius: 1 }
    const k = DEGREES_PER_RADIUS / (c.radius * (r.width / size[0])) // degrees per screen px
    // measured from an element's centre, in screen px
    const ratio = (cx: number, cy: number) => {
      const c = { x: r.left + (cx / size[0]) * r.width, y: r.top + (cy / size[1]) * r.height }
      return Math.hypot(e.clientX - c.x, e.clientY - c.y) / Math.max(1, Math.hypot(d.x - c.x, d.y - c.y))
    }
    // degrees the pointer has swept clockwise around an element's centre
    const swept = (cx: number, cy: number) => {
      const o = { x: r.left + (cx / size[0]) * r.width, y: r.top + (cy / size[1]) * r.height }
      return (Math.atan2(e.clientY - o.y, e.clientX - o.x) - Math.atan2(d.y - o.y, d.x - o.x)) * (180 / Math.PI)
    }
    if (d.grip === 'move') {
      let mx = (dx / r.width) * size[0], my = (dy / r.height) * size[1] // slide px
      const g = d.snap
      const sx = g && !e.altKey ? snapTo([g.box.x, g.box.x + g.box.w / 2, g.box.x + g.box.w], g.x, mx, (SNAP_PX * size[0]) / r.width) : null
      const sy = g && !e.altKey ? snapTo([g.box.y, g.box.y + g.box.h / 2, g.box.y + g.box.h], g.y, my, (SNAP_PX * size[1]) / r.height) : null
      mx += sx?.by ?? 0
      my += sy?.by ?? 0
      setGuides({ x: sx?.at, y: sy?.at })
      d.mover!(mx / size[0], my / size[1])
      highlight(otherSlide(e))
      ghost(d, e, r)
    }
    else if (d.grip === 'resize') {
      d.resizer!(ratio(d.c!.x, d.c!.y))
    }
    else if (d.grip === 'scale') onDevice({ size: clamp(Math.round(d.start.size * ratio(c.cx, c.cy) * 100) / 100, 0.1, 2) })
    else if (d.grip === 'spin') onDevice({ roll: wrap180(snap((d.start.roll ?? 0) - swept(c.cx, c.cy), e.shiftKey)) })
    else if (d.grip === 'rotate') {
      const t = anchor.anchors[d.part!]
      if (t) onRotate(d.part!, wrap180(snap((d.deg ?? 0) + swept(t.x + t.w / 2, t.y + t.h / 2), e.shiftKey)))
    }
    else if (d.grip === 'turn') onDevice({
      yaw: wrap180(snap(d.start.yaw + dx * k, e.shiftKey)),
      pitch: clamp(snap(d.start.pitch + dy * k, e.shiftKey), -90, 90),
    })
    // a foldable folds toward its hinge sideways; a laptop's lid follows the pointer up and down
    else onDevice({ fold: clamp(snap(d.start.fold - (model?.laptop ? -dy : dx) * k, e.shiftKey), 0, 180) })
  }
  // Off its own slide an element would be clipped away, so a copy of it follows the pointer instead.
  const ghost = (d: NonNullable<typeof drag.current>, e: React.PointerEvent, r: DOMRect) => {
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (inside || !anchor || !d.parts) {
      if (d.ghost) d.ghost.el.style.display = 'none'
      return
    }
    const k = r.width / size[0] // screen px per slide px
    if (!d.ghost) {
      const at = d.parts.map((p) => anchor.anchors[p]).filter((a) => !!a)
      if (!at.length) return
      const x0 = Math.min(...at.map((a) => a.x)), y0 = Math.min(...at.map((a) => a.y))
      const x1 = Math.max(...at.map((a) => a.x + a.w)), y1 = Math.max(...at.map((a) => a.y + a.h))
      const pad = Math.max(x1 - x0, y1 - y0) * 0.3 // room for rotation and shadows
      const full = document.createElement('canvas')
      full.width = size[0]
      full.height = size[1]
      drawSlide(full.getContext('2d')!, { ...slide, bg1: 'transparent', bg2: 'transparent', layers: layersOf(slide).filter((p) => d.parts!.includes(p)) }, size[0], size[1])
      const el = document.createElement('canvas')
      el.width = Math.ceil(x1 - x0 + pad * 2)
      el.height = Math.ceil(y1 - y0 + pad * 2)
      el.getContext('2d')!.drawImage(full, pad - x0, pad - y0)
      el.className = 'drag-ghost'
      el.style.width = `${el.width * k}px`
      el.style.height = `${el.height * k}px`
      document.body.append(el)
      // where its top-left sits on screen, and the pointer then
      d.ghost = { el, x: r.left + (x0 - pad) * k - e.clientX, y: r.top + (y0 - pad) * k - e.clientY }
    }
    Object.assign(d.ghost.el.style, { display: '', left: `${e.clientX + d.ghost.x}px`, top: `${e.clientY + d.ghost.y}px` })
  }
  const end = (e: React.PointerEvent) => {
    drag.current?.ghost?.el.remove()
    const over = drag.current?.grip === 'move' && e.type === 'pointerup' ? otherSlide(e) : null
    if (over) {
      const a = ref.current!.getBoundingClientRect(), b = over.getBoundingClientRect()
      onTransfer(over.dataset.slide!, (b.left - a.left) / a.width, (b.top - a.top) / a.height)
    }
    highlight(null)
    drag.current = null
    setLive(null)
    setGuides({})
  }
  const pos = (dxPx = 0, dyPx = 0) => ({ left: `${((dev!.dev!.cx + dxPx) / size[0]) * 100}%`, top: `${((dev!.dev!.cy + dyPx) / size[1]) * 100}%` })
  const box = (b: Rect) => ({
    left: `${(b.x / size[0]) * 100}%`, top: `${(b.y / size[1]) * 100}%`, width: `${(b.w / size[0]) * 100}%`, height: `${(b.h / size[1]) * 100}%`,
  })
  const handlers = { onPointerMove: onMove, onPointerUp: end, onPointerCancel: end }
  // a screenshot dropped on a device goes to that device (a closed foldable's to its outer display)
  const drop = async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    const part = (e.target as HTMLElement).dataset.part ?? 'device'
    if (!file || !accepts(IMAGE_FILES, file.name) || !anchor?.anchors[part]?.dev || !layersOf(slide).includes(part)) return
    const img = await loadImage(file)
    const shot = shotOf(slide, part)
    onShot(part, DEVICE_BY_ID[shot.device.model]?.outer && shot.device.fold < 90 ? { outerImage: img } : { image: img })
  }

  return (
    <div className="slide-wrap" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
      <canvas
        ref={ref}
        data-slide={slide.id}
        width={size[0]}
        height={size[1]}
        className={selected.length ? 'slide selected' : 'slide'}
        onPointerDown={press('device')}
        onContextMenu={menu('device')}
        {...handlers}
      />
      {guides.x !== undefined && <div className="guide v" style={{ left: `${(guides.x / size[0]) * 100}%` }} />}
      {guides.y !== undefined && <div className="guide h" style={{ top: `${(guides.y / size[1]) * 100}%` }} />}
      {anchor && layersOf(slide).map((p) => {
        const at = anchor.anchors[p]
        if (!at) return null
        if (p === editing && at.text) return (
          <TextEditor key={p} at={at} scale={anchor.px} size={size} text={textOf(slide, p)} onChange={(t) => onEditText(p, t)} onDone={() => onEdit(null)} />
        )
        return (
          <div
            key={p}
            data-part={p}
            className={selected.includes(p) && !(at.dev && solo === p) ? 'hit selected' : 'hit'}
            style={{ ...box(at), rotate: at.rotation ? `${at.rotation}deg` : undefined }}
            onPointerDown={press(p)}
            onContextMenu={menu(p)}
            onDoubleClick={at.text ? () => onEdit(p) : undefined}
            {...handlers}
          >
            {solo === p && !at.dev && CORNERS.map((c) => (
              <span key={c} className={`corner ${c}`} title="Drag to resize" onPointerDown={resize([p])} {...handlers} />
            ))}
            {solo === p && !at.dev && (
              <span
                className="spin"
                title="Drag to rotate (Shift snaps to 15°). Double-click to straighten"
                onPointerDown={start('rotate', p)}
                {...handlers}
                onDoubleClick={(e) => { e.stopPropagation(); onRotate(p, 0) }}
              />
            )}
          </div>
        )
      })}
      {group && (
        <div className="device-box" style={box(group)}>
          {CORNERS.map((c) => (
            <span key={c} className={`corner ${c}`} title="Drag to resize the group" onPointerDown={resize(selected)} {...handlers} />
          ))}
        </div>
      )}
      {dev && (
        <>
          <div className="device-box" style={box(dev)}>
            {CORNERS.map((c) => (
              <span key={c} className={`corner ${c}`} title="Drag to resize" onPointerDown={start('scale')} {...handlers} />
            ))}
            <span
              className="spin"
              title="Drag to spin (Shift snaps to 15°). Double-click to straighten"
              onPointerDown={start('spin')}
              {...handlers}
              onDoubleClick={() => onDevice({ roll: 0 })}
            />
          </div>
          <button
            className="grip"
            style={pos()}
            title="Drag to turn in 3D (Shift snaps to 15°). Double-click to face the front"
            onPointerDown={start('turn')}
            {...handlers}
            onDoubleClick={() => onDevice(FRONT)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16.47 4.16A10 10 0 1 1 7.53 4.16" />
              <path d="M7 1v4H3" />
              <ellipse cx="12" cy="13" rx="4" ry="8" />
            </svg>
          </button>
          {(model?.fold || model?.laptop) && (
            <button
              className="grip fold"
              style={model?.laptop ? pos(0, dev.h * 0.38) : pos(-dev.dev!.radius * 0.55)}
              title="Drag to fold (Shift snaps to 15°). Double-click to open flat"
              onPointerDown={start('fold')}
              {...handlers}
              onDoubleClick={() => onDevice({ fold: restFold(model) })}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18M4 6l8-3 8 3v15l-8-3-8 3z" />
              </svg>
            </button>
          )}
          {live && live !== 'move' && live !== 'resize' && live !== 'rotate' && (
            <div className="grip-label" style={pos()}>
              {{
                turn: `Turn ${pose.yaw}°, tilt ${pose.pitch}°`,
                fold: `Open ${pose.fold}°`,
                scale: `Size ${Math.round(pose.size * 100)}%`,
                spin: `Spin ${pose.roll ?? 0}°`,
              }[live]}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const textOf = (s: Slide, p: Part) => s.items?.find((i) => i.id === p)?.text ?? ''

/** Text typed right on the slide, in the slide's own font, while the canvas leaves that text out. */
function TextEditor({ at, scale, size, text, onChange, onDone }: {
  at: Anchor
  scale: number // css px per slide px
  size: readonly [number, number]
  text: string
  onChange: (text: string) => void
  onDone: () => void
}) {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const d = el.current!
    d.textContent = text // uncontrolled from here on, so typing never fights React for the caret
    d.focus()
    getSelection()?.selectAllChildren(d)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const t = at.text!
  return (
    <div
      ref={el}
      className="text-edit"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      style={{
        // the canvas draws text from the top of its em box; CSS centres it in the line
        left: `${((t.cx - t.wrap / 2) / size[0]) * 100}%`,
        top: `${((at.y - t.size * 0.075) / size[1]) * 100}%`,
        width: `${(t.wrap / size[0]) * 100}%`,
        font: `${t.weight} ${t.size * scale}px/1.15 ${t.font}`,
        color: t.color,
        opacity: t.alpha,
        rotate: at.rotation ? `${at.rotation}deg` : undefined,
        transformOrigin: `50% ${(at.h / 2 + t.size * 0.075) * scale}px`, // the text's centre, as the canvas turns it
      }}
      onInput={(e) => onChange(e.currentTarget.innerText.replace(/\n$/, ''))}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) e.currentTarget.blur()
      }}
    />
  )
}
