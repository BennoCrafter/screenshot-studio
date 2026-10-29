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
  image: HTMLImageElement | null
  outerImage: HTMLImageElement | null // foldables' outer display
  device: DevicePose
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

export type Platform = 'iphone' | 'ipad' | 'mac'

/** Per platform: its store sizes (first is the default) and the device a new slide starts with. */
export const PLATFORMS: Record<Platform, { label: string; sizes: SizeName[]; device: Partial<DevicePose> }> = {
  iphone: { label: 'iPhone', sizes: ['iPhone 6.9"', 'iPhone 6.3"', 'iPhone 6.5"', 'iPhone Duo inner', 'iPhone Duo outer'], device: { model: 'iphone-18-pro-max', finish: 'glacier', size: 0.74 } },
  ipad: { label: 'iPad', sizes: ['iPad 13"', 'iPad 11"'], device: { model: 'ipad-pro-13', finish: 'space-black', size: 0.8 } },
  mac: { label: 'Mac', sizes: ['Mac 2880×1800', 'Mac 2560×1600', 'Mac 1440×900', 'Mac 1280×800'], device: { model: 'macbook-pro-14', finish: 'space-black', size: 0.46, pitch: 14, fold: 110 } },
}

/** One platform's set of slides inside a project. */
export interface Target {
  platform: Platform
  size: SizeName
  slides: Slide[]
}

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif'

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

// Draws a text block centered horizontally starting at y; returns the y below it.
function drawText(ctx: CanvasRenderingContext2D, text: string, y: number, w: number, size: number, weight: number) {
  if (!text.trim()) return y
  ctx.font = `${weight} ${size}px ${FONT}`
  const lh = size * 1.15
  for (const line of wrap(ctx, text, w * 0.84)) {
    ctx.fillText(line, w / 2, y)
    y += lh
  }
  return y
}

function textHeight(ctx: CanvasRenderingContext2D, text: string, w: number, size: number, weight: number) {
  if (!text.trim()) return 0
  ctx.font = `${weight} ${size}px ${FONT}`
  return wrap(ctx, text, w * 0.84).length * size * 1.15
}

/** Draws the slide; returns the device centre, flat half-height and drawn box, in slide px, for the handles. */
export function drawSlide(ctx: CanvasRenderingContext2D, s: Slide, w: number, h: number) {
  // background
  const a = (s.angle * Math.PI) / 180
  const r = Math.hypot(w, h) / 2
  const dx = Math.sin(a) * r, dy = -Math.cos(a) * r
  const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy)
  g.addColorStop(0, s.bg1)
  g.addColorStop(1, s.bg2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // text block
  const unit = Math.min(w, h * 0.8) // portrait sizes by width; landscape (Mac) is held back by height
  const titleSize = unit * 0.085, subSize = unit * 0.042, gap = subSize * 0.6, pad = h * 0.06
  const textH =
    textHeight(ctx, s.title, w, titleSize, 800) + gap + textHeight(ctx, s.subtitle, w, subSize, 500)
  const textY = s.layout === 'text-top' ? pad : h - pad - textH
  ctx.fillStyle = s.textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let y = drawText(ctx, s.title, textY, w, titleSize, 800)
  ctx.globalAlpha = 0.85
  drawText(ctx, s.subtitle, y + gap, w, subSize, 500)
  ctx.globalAlpha = 1

  // device: rendered in 3D, bleeding off the edge opposite the text
  const dev = renderDevice(s.device, s.image, s.outerImage, w * s.device.size)
  // Phones keep their resting height so turning never shifts them; a laptop's shape depends
  // so much on its lid that it's laid out by what's actually drawn.
  const tall = dev.laptop ? dev.height : dev.flatHeight
  const top = s.layout === 'text-top' ? textY + textH + pad * 0.8 : textY - pad * 0.8 - tall
  const cx = w / 2 + s.device.x * w
  const cy = top + tall / 2 + s.device.y * h
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = w * 0.05
  ctx.shadowOffsetY = w * 0.015
  ctx.drawImage(dev.canvas, cx - dev.width / 2, cy - dev.height / 2, dev.width, dev.height)
  ctx.restore()
  return { cx, cy, radius: dev.flatHeight / 2, w: dev.width, h: dev.height }
}
