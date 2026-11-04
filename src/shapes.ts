// Vector elements: shapes, badges and icons, drawn in one color. Items store the name (kind 'shape', shape: name), so
// files stay small and a shape can be redrawn sharp at any size.

/** A path in a vw × vh box, filled, or stroked `stroke` wide (in box units) with round ends. */
export interface Shape { label: string; group: 'Shapes' | 'Badges' | 'Icons'; vw: number; vh: number; x0?: number; y0?: number; d: string; stroke?: number; color?: string; evenodd?: boolean }

const n = (v: number) => +v.toFixed(2)

/** A five-pointed star centered on (cx, cy). */
function star(cx: number, cy: number, r: number) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r * 0.45 : r
    return `${n(cx + k * Math.cos(a))} ${n(cy + k * Math.sin(a))}`
  })
  return `M${pts.join('L')}Z`
}

/** A leaf: a lens from (bx, by), `len` long at angle `a`, `wide` across. */
function leaf(bx: number, by: number, a: number, len: number, wide: number) {
  const tx = bx + len * Math.cos(a), ty = by + len * Math.sin(a)
  const r = (len * len / 4 + (wide / 2) ** 2) / wide // the arc through both ends, bulging wide / 2
  return `M${n(bx)} ${n(by)}A${n(r)} ${n(r)} 0 0 1 ${n(tx)} ${n(ty)}A${n(r)} ${n(r)} 0 0 1 ${n(bx)} ${n(by)}Z`
}

/** A laurel branch round (cx, cy): a stem curving up the left (side -1) or right (1), with leaves either side. */
function laurel(cx: number, cy: number, r: number, side: 1 | -1) {
  const from = Math.PI / 2 + side * 0.25, to = Math.PI / 2 + side * 2.55 // from near the bottom up to the top
  const at = (a: number, k = r) => [cx + k * Math.cos(a), cy + k * Math.sin(a)]
  // the stem: a thin band, always wound clockwise like the leaves, or where they overlap they'd cancel out
  const [a0, a1] = side === 1 ? [from, to] : [to, from]
  const [o1x, o1y] = at(a0, r + 0.7), [o2x, o2y] = at(a1, r + 0.7), [i2x, i2y] = at(a1, r - 0.7), [i1x, i1y] = at(a0, r - 0.7)
  let d = `M${n(o1x)} ${n(o1y)}A${n(r + 0.7)} ${n(r + 0.7)} 0 0 1 ${n(o2x)} ${n(o2y)}L${n(i2x)} ${n(i2y)}A${n(r - 0.7)} ${n(r - 0.7)} 0 0 0 ${n(i1x)} ${n(i1y)}Z`
  for (let i = 0; i < 6; i++) {
    const a = from + (to - from) * (0.08 + i * 0.165), [bx, by] = at(a)
    const up = a + side * (Math.PI / 2) // along the stem, towards its tip
    const len = 12 - i * 0.9, wide = len * 0.42
    d += leaf(bx, by, up - side * 0.75, len, wide) + leaf(bx, by, up + side * 0.6, len * 0.85, wide * 0.9) // outside, inside
  }
  const [tx, ty] = at(to)
  return d + leaf(tx, ty, to + side * (Math.PI / 2), 9, 3.8) // the tip
}

// Icons: Material Design Icons (Apache 2.0), filled.
export const SHAPES: Record<string, Shape> = {
  triangle: { label: 'Triangle', group: 'Shapes', vw: 24, vh: 22, d: 'M12 1 23 21H1z' },
  star: { label: 'Star', group: 'Shapes', vw: 24, vh: 24, d: star(12, 12.8, 11.5) },
  arrow: { label: 'Arrow', group: 'Shapes', vw: 24, vh: 16, d: 'M1 6h14V1l8 7-8 7v-5H1z' },
  line: { label: 'Line', group: 'Shapes', vw: 24, vh: 2, d: 'M1 1H23', stroke: 2 },

  rating: { label: 'Rating', group: 'Badges', vw: 120, vh: 24, d: [0, 1, 2, 3, 4].map((i) => star(12 + i * 24, 12.8, 11.5)).join(''), color: '#ffcc00' },
  laurels: { label: 'Laurels', group: 'Badges', vw: 76, vh: 61, d: laurel(38, 30, 27, -1) + laurel(38, 30, 27, 1) },
  callout: { label: 'Callout arrow', group: 'Badges', vw: 24, vh: 24, d: 'M3 21C5 11 11 5 20 4M14 2.5 20 4l-2.5 5.5', stroke: 2 },

  heart: { label: 'Heart', group: 'Icons', vw: 24, vh: 24, d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
  check: { label: 'Check', group: 'Icons', vw: 24, vh: 24, d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' },
  sparkle: { label: 'Sparkle', group: 'Icons', vw: 24, vh: 24, d: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z' },
  bolt: { label: 'Bolt', group: 'Icons', vw: 24, vh: 24, d: 'M7 2v11h3v9l7-12h-4l4-8z' },
  bell: { label: 'Bell', group: 'Icons', vw: 24, vh: 24, d: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z' },
  chat: { label: 'Chat', group: 'Icons', vw: 24, vh: 24, d: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z' },
  lock: { label: 'Lock', group: 'Icons', vw: 24, vh: 24, d: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z' },
  shield: { label: 'Shield', group: 'Icons', vw: 24, vh: 24, d: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z' },
  cloud: { label: 'Cloud', group: 'Icons', vw: 24, vh: 24, d: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z' },
  trending: { label: 'Growth', group: 'Icons', vw: 24, vh: 24, d: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z' },
}

/** Draws `shape` filling the box (x, y, w, h); strokes keep their width however the box is stretched. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: Pick<Shape, 'd' | 'vw' | 'vh' | 'x0' | 'y0' | 'stroke' | 'evenodd'>, x: number, y: number, w: number, h: number, color: string) {
  const sx = w / shape.vw, sy = h / shape.vh
  const path = new Path2D()
  path.addPath(new Path2D(shape.d), new DOMMatrix([sx, 0, 0, sy, x - (shape.x0 ?? 0) * sx, y - (shape.y0 ?? 0) * sy]))
  if (shape.stroke) {
    ctx.strokeStyle = color
    ctx.lineWidth = shape.stroke * Math.min(sx, sy)
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.stroke(path)
  } else {
    ctx.fillStyle = color
    ctx.fill(path, shape.evenodd ? 'evenodd' : 'nonzero')
  }
}
