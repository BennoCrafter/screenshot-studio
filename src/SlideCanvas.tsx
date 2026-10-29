import { useEffect, useRef, useState } from 'react'
import { DEVICE_BY_ID, restFold } from './devices/models'
import type { DevicePose } from './devices/render3d'
import { loadImage } from './project'
import { drawSlide, type Slide } from './render'

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const snap = (v: number, on: boolean) => (on ? Math.round(v / 15) * 15 : Math.round(v))

const FRONT: Partial<DevicePose> = { yaw: 0, pitch: 0, roll: 0 }
const DEGREES_PER_RADIUS = 75 // a drag across the device's radius turns it this far (as in open-screenshot-generator)

type Grip = 'move' | 'turn' | 'fold' | 'scale' | 'spin'

// Same model as open-screenshot-generator: dragging the device moves it, the round grip
// in its middle turns it like a turntable, a foldable's second grip folds it. Shift snaps to 15°.
export function SlideCanvas({ slide, size, selected, onSelect, onImage, onDevice }: {
  slide: Slide
  size: readonly [number, number]
  selected: boolean
  onSelect: () => void
  onImage: (patch: Partial<Slide>) => void
  onDevice: (patch: Partial<DevicePose>) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ grip: Grip; x: number; y: number; start: DevicePose } | null>(null)
  const [anchor, setAnchor] = useState({ cx: 0, cy: 0, radius: 1, w: 0, h: 0 })
  const [live, setLive] = useState<Grip | null>(null)
  useEffect(() => {
    setAnchor(drawSlide(ref.current!.getContext('2d')!, slide, size[0], size[1]))
  }, [slide, size])

  const model = DEVICE_BY_ID[slide.device.model]
  const closed = slide.device.fold < 90

  const start = (grip: Grip) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault() // no text/image selection while dragging
    e.stopPropagation()
    onSelect()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { grip, x: e.clientX, y: e.clientY, start: slide.device }
    setLive(grip)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const r = ref.current!.getBoundingClientRect()
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    const k = DEGREES_PER_RADIUS / (anchor.radius * (r.width / size[0])) // degrees per screen px
    if (d.grip === 'move') onDevice({ x: d.start.x + dx / r.width, y: d.start.y + dy / r.height })
    else if (d.grip === 'scale' || d.grip === 'spin') {
      // measured from the device centre, in screen px
      const c = { x: r.left + (anchor.cx / size[0]) * r.width, y: r.top + (anchor.cy / size[1]) * r.height }
      if (d.grip === 'scale') {
        const ratio = Math.hypot(e.clientX - c.x, e.clientY - c.y) / Math.max(1, Math.hypot(d.x - c.x, d.y - c.y))
        onDevice({ size: clamp(Math.round(d.start.size * ratio * 100) / 100, 0.1, 2) })
      } else {
        const turned = (Math.atan2(e.clientY - c.y, e.clientX - c.x) - Math.atan2(d.y - c.y, d.x - c.x)) * (180 / Math.PI)
        onDevice({ roll: wrap180(snap((d.start.roll ?? 0) - turned, e.shiftKey)) })
      }
    }
    else if (d.grip === 'turn') onDevice({
      yaw: wrap180(snap(d.start.yaw + dx * k, e.shiftKey)),
      pitch: clamp(snap(d.start.pitch + dy * k, e.shiftKey), -90, 90),
    })
    // a foldable folds toward its hinge sideways; a laptop's lid follows the pointer up and down
    else onDevice({ fold: clamp(snap(d.start.fold - (model?.laptop ? -dy : dx) * k, e.shiftKey), 0, 180) })
  }
  const end = () => {
    drag.current = null
    setLive(null)
  }
  const pos = (dxPx = 0, dyPx = 0) => ({ left: `${((anchor.cx + dxPx) / size[0]) * 100}%`, top: `${((anchor.cy + dyPx) / size[1]) * 100}%` })
  const handlers = { onPointerMove: onMove, onPointerUp: end, onPointerCancel: end }

  return (
    <div className="slide-wrap">
      <canvas
        ref={ref}
        data-slide={slide.id}
        width={size[0]}
        height={size[1]}
        className={selected ? 'slide selected' : 'slide'}
        onPointerDown={start('move')}
        {...handlers}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (!file?.type.startsWith('image/')) return
          const img = await loadImage(file)
          // a closed foldable shows its outer display, so that's where the screenshot goes
          onImage(model?.outer && closed ? { outerImage: img } : { image: img })
        }}
      />
      {selected && (
        <>
          <div
            className="device-box"
            style={{
              left: `${((anchor.cx - anchor.w / 2) / size[0]) * 100}%`,
              top: `${((anchor.cy - anchor.h / 2) / size[1]) * 100}%`,
              width: `${(anchor.w / size[0]) * 100}%`,
              height: `${(anchor.h / size[1]) * 100}%`,
            }}
          >
            {['nw', 'ne', 'se', 'sw'].map((c) => (
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
              style={model?.laptop ? pos(0, anchor.h * 0.38) : pos(-anchor.radius * 0.55)}
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
          {live && live !== 'move' && (
            <div className="grip-label" style={pos()}>
              {{
                turn: `Turn ${slide.device.yaw}°, tilt ${slide.device.pitch}°`,
                fold: `Open ${slide.device.fold}°`,
                scale: `Size ${Math.round(slide.device.size * 100)}%`,
                spin: `Spin ${slide.device.roll ?? 0}°`,
              }[live]}
            </div>
          )}
        </>
      )}
    </div>
  )
}

