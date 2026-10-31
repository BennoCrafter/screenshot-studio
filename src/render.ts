import { renderDevice, type DevicePose } from './devices/render3d'

// One draw function for both preview and export, so what you see is exactly what you get.

export type Layout = 'text-top' | 'text-bottom'

export interface Slide {
  id: string
  title: string
  subtitle: string
  bg1: string
  bg2: string
  angle: number // gradient angle, degrees
  textColor: string
  layout: Layout
  titleBox?: TextBox
  subtitleBox?: TextBox
  items?: Item[] // objects added on top of the built-in ones
  layers?: Part[] // what's on the slide, back to front; a part left out is deleted
  image: HTMLImageElement | null
  outerImage: HTMLImageElement | null // foldables' outer display
  device: DevicePose
  translations?: Record<string, Translation> // other languages' text; everything else is shared
  primary?: Pick<Slide, 'title' | 'subtitle'> // set by localize: the text the device is laid out by, so languages never move it
}

export interface Translation {
  title: string
  subtitle: string
  items?: Record<string, string> // added texts by item id
  shots?: Record<Part, LangShot> // screenshots by device part ('device' or an item id)
}
/** A device's screenshots in one language; a missing (or null) one shows the primary language's. */
export interface LangShot { image?: HTMLImageElement | null; outerImage?: HTMLImageElement | null }

/** An element on a slide: 'title', 'subtitle', 'device' or an item's id. The background sits behind them all. */
export type Part = string
export type TextPart = 'title' | 'subtitle'
export const BUILT_IN_PARTS: Part[] = ['title', 'subtitle', 'device']

/** An added object. Positions are its centre, as fractions of slide width and height; sizes are fractions of slide width. */
export interface Item {
  id: string
  kind: 'text' | 'rect' | 'ellipse' | 'image' | 'device'
  x: number
  y: number
  w: number // text wraps at this width
  h: number // shapes and images
  size?: number // text: font size
  text?: string
  color?: string // text (the slide's text colour if unset) and shapes
  rotation?: number // degrees clockwise (not devices: they spin with their pose)
  image?: HTMLImageElement | null // images, and devices' screenshots
  outerImage?: HTMLImageElement | null // devices: a foldable's outer display
  device?: DevicePose // devices: placed by x, y; its size is a fraction of slide width
}
/** A text's offset from where the layout puts it (fractions of slide width/height), its size, 1 being the layout's, and its turn in degrees clockwise. */
export interface TextBox { x: number; y: number; scale: number; rotation?: number }
export const NO_BOX: TextBox = { x: 0, y: 0, scale: 1 }
export const layersOf = (s: Pick<Slide, 'layers'>): Part[] => s.layers ?? BUILT_IN_PARTS

/** The slide with `lang`'s text and screenshots, falling back to the primary language's. */
export function localize(s: Slide, lang?: string): Slide {
  const t = lang ? s.translations?.[lang] : undefined
  return t ? {
    ...s,
    primary: { title: s.title, subtitle: s.subtitle },
    title: t.title || s.title,
    subtitle: t.subtitle || s.subtitle,
    image: t.shots?.device?.image ?? s.image,
    outerImage: t.shots?.device?.outerImage ?? s.outerImage,
    items: s.items?.map((i) => ({
      ...i,
      ...(t.items?.[i.id] ? { text: t.items[i.id] } : {}),
      ...(t.shots?.[i.id] ? { image: t.shots[i.id].image ?? i.image, outerImage: t.shots[i.id].outerImage ?? i.outerImage } : {}),
    })),
  } : s
}

export type Style = Pick<Slide, 'bg1' | 'bg2' | 'angle' | 'textColor' | 'layout'>

export const THEMES: Record<string, Style> = {
  Midnight: { bg1: '#1e1b4b', bg2: '#4c1d95', angle: 160, textColor: '#ffffff', layout: 'text-top' },
  Sunrise: { bg1: '#fb923c', bg2: '#f43f5e', angle: 135, textColor: '#ffffff', layout: 'text-top' },
  Mint: { bg1: '#d1fae5', bg2: '#a7f3d0', angle: 180, textColor: '#064e3b', layout: 'text-top' },
  Paper: { bg1: '#fafaf9', bg2: '#e7e5e4', angle: 180, textColor: '#1c1917', layout: 'text-bottom' },
  Ocean: { bg1: '#0ea5e9', bg2: '#1e3a8a', angle: 200, textColor: '#ffffff', layout: 'text-bottom' },
}

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

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
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

function textHeight(ctx: CanvasRenderingContext2D, text: string, w: number, size: number, weight: number) {
  if (!text.trim()) return 0
  ctx.font = `${weight} ${size}px ${FONT}`
  return wrap(ctx, text, w * 0.84).length * size * 1.15
}

export const TEXT_STYLE = { title: { weight: 800, alpha: 1 }, subtitle: { weight: 500, alpha: 0.85 }, item: { weight: 600, alpha: 1 } } as const

/** Where an element landed, in slide px; texts also say how they're set, for typing on top of them. */
export interface Anchor {
  x: number
  y: number
  w: number
  h: number
  rotation?: number // degrees clockwise about its centre
  text?: { cx: number; wrap: number; size: number; weight: number; alpha: number; color: string; lines: string[] }
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
  const setText = (text: string, cx: number, top: number, wrapW: number, size: number, style: { weight: number; alpha: number }, color: string): Anchor => {
    ctx.font = `${style.weight} ${size}px ${FONT}`
    const lines = text.trim() ? wrap(ctx, text, wrapW) : []
    const lw = Math.max(size * 2, ...lines.map((l) => ctx.measureText(l).width))
    // an empty text keeps one line's height so it can still be grabbed
    return { x: cx - lw / 2, y: top, w: lw, h: Math.max(1, lines.length) * size * 1.15, text: { cx, wrap: wrapW, size, color, lines, ...style } }
  }

  // texts: laid out at their resting spots, so moving or resizing one leaves everything else in place
  const unit = Math.min(w, h * 0.8) // portrait sizes by width; landscape (Mac) is held back by height
  const base = { title: unit * 0.085, subtitle: unit * 0.042 }
  const gap = base.subtitle * 0.6, pad = h * 0.06
  const titleH = textHeight(ctx, s.title, w, base.title, 800)
  const baseH = titleH + gap + textHeight(ctx, s.subtitle, w, base.subtitle, 500)
  const baseY = s.layout === 'text-top' ? pad : h - pad - baseH
  const lay = (p: TextPart, restY: number) => {
    const b = s[`${p}Box`] ?? NO_BOX
    return { ...setText(s[p], w / 2 + b.x * w, restY + b.y * h, w * 0.84 * b.scale, base[p] * b.scale, TEXT_STYLE[p], s.textColor), rotation: b.rotation }
  }
  const anchors: Record<Part, Anchor> = { title: lay('title', baseY), subtitle: lay('subtitle', baseY + titleH + gap) }

  // device: rendered in 3D, bleeding off the edge opposite the text
  const dev = renderDevice(s.device, s.image, s.outerImage, w * s.device.size)
  // Phones keep their resting height so turning never shifts them; a laptop's shape depends
  // so much on its lid that it's laid out by what's actually drawn.
  const tall = dev.laptop ? dev.height : dev.flatHeight
  // placed by the primary language's text, so a translation that wraps differently leaves it put
  const p0 = s.primary ?? s
  const restH = textHeight(ctx, p0.title, w, base.title, 800) + gap + textHeight(ctx, p0.subtitle, w, base.subtitle, 500)
  const top = s.layout === 'text-top' ? pad + restH + pad * 0.8 : h - pad - restH - pad * 0.8 - tall
  const cx = w / 2 + s.device.x * w
  const cy = top + tall / 2 + s.device.y * h
  anchors.device = { x: cx - dev.width / 2, y: cy - dev.height / 2, w: dev.width, h: dev.height, dev: { cx, cy, radius: dev.flatHeight / 2 } }
  const drawn: Record<Part, HTMLCanvasElement> = { device: own(dev.canvas) }

  for (const i of s.items ?? []) {
    if (i.kind === 'text') {
      const t = setText(i.text ?? '', i.x * w, 0, i.w * w, (i.size ?? 0.05) * w, TEXT_STYLE.item, i.color ?? s.textColor)
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
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = w * 0.05
      ctx.shadowOffsetY = w * 0.015
      ctx.drawImage(drawn[p], at.x, at.y, at.w, at.h)
    } else if (at.text) {
      const t = at.text
      ctx.font = `${t.weight} ${t.size}px ${FONT}`
      ctx.fillStyle = t.color
      ctx.globalAlpha = t.alpha
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      t.lines.forEach((line, n) => ctx.fillText(line, t.cx, at.y + n * t.size * 1.15))
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
