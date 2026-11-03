import { renderDevice, type DevicePose } from './devices/render3d'
import { drawShape, SHAPES } from './shapes'
import builtinThemes from './builtin/themes.json'

// One draw function for both preview and export, so what you see is exactly what you get.

export interface Slide {
  id: string
  bg1: string
  bg2: string
  angle: number // gradient angle, degrees
  textColor: string // texts without a color of their own
  items?: Item[] // texts, shapes, images and extra devices
  layers?: Part[] // what's on the slide, back to front; a part left out is deleted
  image: HTMLImageElement | null
  outerImage: HTMLImageElement | null // foldables' outer display
  device: DevicePose
  shotId?: string // the device's screenshot ID, for automations that replace screenshots (replace_screenshots)
  translations?: Record<string, Translation> // other languages' text; everything else is shared
}

export interface Translation {
  items?: Record<string, string> // texts by item id
  shots?: Record<Part, LangShot> // screenshots by device part ('device' or an item id)
}
/** A device's screenshots in one language; a missing (or null) one shows the primary language's. */
export interface LangShot { image?: HTMLImageElement | null; outerImage?: HTMLImageElement | null }

/** An element on a slide: 'device' (the slide's own) or an item's id. The background sits behind them all. */
export type Part = string

/** An added object. Positions are its centre, as fractions of slide width and height; sizes are fractions of slide width. */
export interface Item {
  id: string
  kind: 'text' | 'rect' | 'ellipse' | 'shape' | 'image' | 'device'
  shape?: string // shapes: a name in SHAPES (shapes.ts)
  x: number
  y: number
  w: number // text wraps at this width
  h: number // shapes and images
  size?: number // text: font size
  font?: string // text: CSS font family, the system font if unset
  weight?: number // text: font weight, 600 if unset
  opacity?: number // text: 1 if unset
  text?: string
  color?: string // text (the slide's text color if unset), rects, ellipses and shapes
  rotation?: number // degrees clockwise (not devices: they spin with their pose)
  image?: HTMLImageElement | null // images, and devices' screenshots
  outerImage?: HTMLImageElement | null // devices: a foldable's outer display
  device?: DevicePose // devices: placed by x, y; its size is a fraction of slide width
  shotId?: string // images and devices: screenshot ID, as on Slide
}
export const layersOf = (s: Pick<Slide, 'layers'>): Part[] => s.layers ?? ['device']

/** The slide with `lang`'s text and screenshots, falling back to the primary language's. */
export function localize(s: Slide, lang?: string): Slide {
  const t = lang ? s.translations?.[lang] : undefined
  return t ? {
    ...s,
    image: t.shots?.device?.image ?? s.image,
    outerImage: t.shots?.device?.outerImage ?? s.outerImage,
    items: s.items?.map((i) => ({
      ...i,
      ...(t.items?.[i.id] ? { text: t.items[i.id] } : {}),
      ...(t.shots?.[i.id] ? { image: t.shots[i.id].image ?? i.image, outerImage: t.shots[i.id].outerImage ?? i.outerImage } : {}),
    })),
  } : s
}

export type Style = Pick<Slide, 'bg1' | 'bg2' | 'angle' | 'textColor'>

export const THEMES: Record<string, Style> = builtinThemes // the built-in themes live in builtin/themes.json

export const SIZES = {
  'iPhone 6.9"': [1320, 2868],
  'iPhone 6.3"': [1206, 2622],
  'iPhone 6.5"': [1242, 2688],
  'iPhone Duo inner': [2007, 2853],
  'iPhone Duo outer': [1398, 2034],
  'iPad 13"': [2064, 2752],
  'iPad 11"': [1668, 2420],
  'Mac 2880×1800': [2880, 1800],
  'Mac 2560×1600': [2560, 1600],
  'Mac 1440×900': [1440, 900],
  'Mac 1280×800': [1280, 800],
} as const satisfies Record<string, readonly [number, number]>

export type SizeName = keyof typeof SIZES

export type Platform = 'iphone' | 'duo' | 'ipad' | 'mac'

/** Per platform: its store sizes (first is the default) and the device a new slide starts with. */
export const PLATFORMS: Record<Platform, { label: string; sizes: SizeName[]; device: Partial<DevicePose> }> = {
  iphone: { label: 'iPhone', sizes: ['iPhone 6.9"', 'iPhone 6.3"', 'iPhone 6.5"'], device: { model: 'iphone-18-pro-max', finish: 'glacier', size: 0.74 } },
  duo: { label: 'iPhone Duo', sizes: ['iPhone Duo inner', 'iPhone Duo outer'], device: { model: 'iphone-duo', finish: 'night-sky', size: 0.9 } },
  ipad: { label: 'iPad', sizes: ['iPad 13"', 'iPad 11"'], device: { model: 'ipad-pro-13', finish: 'space-black', size: 0.8 } },
  mac: { label: 'Mac', sizes: ['Mac 2880×1800', 'Mac 2560×1600', 'Mac 1440×900', 'Mac 1280×800'], device: { model: 'macbook-pro-14', finish: 'space-black', size: 0.46, pitch: 14, fold: 110 } },
}

/** One platform's set of slides inside a project. */
export interface Target {
  platform: Platform
  size: SizeName
  slides: Slide[]
}

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif'
/** The fonts a text can pick, by name; each falls back to the system font where it isn't installed. */
export const FONTS: Record<string, string> = {
  System: FONT,
  Rounded: `ui-rounded, "SF Pro Rounded", ${FONT}`,
  Serif: 'ui-serif, "New York", Georgia, serif',
  Mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  ...Object.fromEntries(['Helvetica Neue', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Georgia', 'Baskerville', 'Didot', 'American Typewriter', 'Marker Felt', 'Chalkboard SE']
    .map((f) => [f, `"${f}", ${FONT}`])),
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}


/** Where an element landed, in slide px; texts also say how they're set, for typing on top of them. */
export interface Anchor {
  x: number
  y: number
  w: number
  h: number
  rotation?: number // degrees clockwise about its centre
  text?: { cx: number; wrap: number; size: number; font: string; weight: number; alpha: number; color: string; lines: string[] }
  dev?: { cx: number; cy: number; radius: number } // devices: centre and flat half-height, for the turn grips
}

/** Draws the slide, leaving out `hide` (the text being edited on top of it). Returns each element's anchor, for the handles. */
export function drawSlide(ctx: CanvasRenderingContext2D, s: Slide, w: number, h: number, hide?: Part) {
  // background
  const a = (s.angle * Math.PI) / 180
  const r = Math.hypot(w, h) / 2
  const dx = Math.sin(a) * r, dy = -Math.cos(a) * r
  const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy)
  g.addColorStop(0, s.bg1)
  g.addColorStop(1, s.bg2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  /** A centred text block whose first line's top sits at `top`. */
  const setText = (text: string, cx: number, top: number, wrapW: number, size: number, style: { font: string; weight: number; alpha: number }, color: string): Anchor => {
    ctx.font = `${style.weight} ${size}px ${style.font}`
    const lines = text.trim() ? wrap(ctx, text, wrapW) : []
    const lw = Math.max(size * 2, ...lines.map((l) => ctx.measureText(l).width))
    // an empty text keeps one line's height so it can still be grabbed
    return { x: cx - lw / 2, y: top, w: lw, h: Math.max(1, lines.length) * size * 1.15, text: { cx, wrap: wrapW, size, color, lines, ...style } }
  }

  // device: rendered in 3D, centred on the slide's middle plus its offset
  const dev = renderDevice(s.device, s.image, s.outerImage, w * s.device.size)
  const cx = w / 2 + s.device.x * w
  const cy = h / 2 + s.device.y * h
  const anchors: Record<Part, Anchor> = {}
  anchors.device = { x: cx - dev.width / 2, y: cy - dev.height / 2, w: dev.width, h: dev.height, dev: { cx, cy, radius: dev.flatHeight / 2 } }
  const drawn: Record<Part, HTMLCanvasElement> = { device: own(dev.canvas) }

  for (const i of s.items ?? []) {
    if (i.kind === 'text') {
      const t = setText(i.text ?? '', i.x * w, 0, i.w * w, (i.size ?? 0.05) * w, { font: i.font ?? FONT, weight: i.weight ?? 600, alpha: i.opacity ?? 1 }, i.color ?? s.textColor)
      anchors[i.id] = { ...t, y: i.y * h - t.h / 2, rotation: i.rotation } // centred on its spot, growing both ways
    } else if (i.kind === 'device' && i.device) {
      const d = renderDevice(i.device, i.image ?? null, i.outerImage ?? null, w * i.device.size)
      const icx = i.x * w, icy = i.y * h
      drawn[i.id] = own(d.canvas)
      anchors[i.id] = { x: icx - d.width / 2, y: icy - d.height / 2, w: d.width, h: d.height, dev: { cx: icx, cy: icy, radius: d.flatHeight / 2 } }
    } else anchors[i.id] = { x: (i.x - i.w / 2) * w, y: i.y * h - (i.h * w) / 2, w: i.w * w, h: i.h * w, rotation: i.rotation }
  }

  for (const p of layersOf(s)) {
    const at = anchors[p]
    if (p === hide || !at) continue
    const item = s.items?.find((i) => i.id === p)
    ctx.save()
    if (at.rotation) {
      const cx = at.x + at.w / 2, cy = at.y + at.h / 2
      ctx.translate(cx, cy)
      ctx.rotate((at.rotation * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }
    if (drawn[p]) {
      if ((item?.device ?? s.device).shadow !== false) {
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = w * 0.05
        ctx.shadowOffsetY = w * 0.015
      }
      ctx.drawImage(drawn[p], at.x, at.y, at.w, at.h)
    } else if (at.text) {
      const t = at.text
      ctx.font = `${t.weight} ${t.size}px ${t.font}`
      ctx.fillStyle = t.color
      ctx.globalAlpha = t.alpha
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      t.lines.forEach((line, n) => ctx.fillText(line, t.cx, at.y + n * t.size * 1.15))
    } else if (item?.kind === 'shape') {
      const shape = SHAPES[item.shape ?? '']
      if (shape) drawShape(ctx, shape, at.x, at.y, at.w, at.h, item.color ?? s.textColor)
    } else if (item?.kind === 'image') {
      if (item.image) ctx.drawImage(item.image, at.x, at.y, at.w, at.h)
    } else if (item) {
      ctx.fillStyle = item.color ?? s.textColor
      ctx.beginPath()
      if (item.kind === 'ellipse') ctx.ellipse(at.x + at.w / 2, at.y + at.h / 2, at.w / 2, at.h / 2, 0, 0, Math.PI * 2)
      else ctx.roundRect(at.x, at.y, at.w, at.h, Math.min(at.w, at.h) * 0.12)
      ctx.fill()
    }
    ctx.restore()
  }
  return anchors
}

/** A copy of renderDevice's shared canvas, so the next device rendered doesn't paint over it. */
function own(c: HTMLCanvasElement) {
  const k = document.createElement('canvas')
  k.width = c.width
  k.height = c.height
  k.getContext('2d')!.drawImage(c, 0, 0)
  return k
}

/** A slide drawn at full size off screen, as a PNG; `scale` shrinks it. */
export function renderSlide(s: Slide, [w, h]: readonly [number, number], scale = 1) {
  const full = document.createElement('canvas')
  full.width = w
  full.height = h
  drawSlide(full.getContext('2d')!, s, w, h)
  let out = full
  if (scale < 1) {
    out = document.createElement('canvas')
    out.width = Math.round(w * scale)
    out.height = Math.round(h * scale)
    out.getContext('2d')!.drawImage(full, 0, 0, out.width, out.height)
  }
  return new Promise<Blob>((resolve) => out.toBlob((b) => resolve(b!), 'image/png'))
}
