// Open Screenshot Generator (openscrgen.app) projects and templates, read as a project here. Its files hold the
// artboards as `projectData`: elements placed by their top-left corner in board px, uploads as `asset:<id>` in `mediaData`.

import { toDataUrl, type ProjectFont, type WithImages } from './project'
import { FONT, PLATFORMS, SIZES, type Item, type Platform, type SizeName } from './render'
import { poseFor } from './templates'

type Data = WithImages<string | null>
type Slide = Data['targets'][number]['slides'][number]
type El = Record<string, any> // shortcut: their element types are loose and many; read only the fields mapped below

const SITE = 'https://editor.openscrgen.app' // their built-in templates point at screenshots under /data/projects/

/** True for a file Open Screenshot Generator saved or ships as a template. */
export const isOpenScrGen = (data: any) => Array.isArray(data?.projectData)

export async function fromOpenScrGen(data: any): Promise<Data> {
  const mime = Object.fromEntries((data.media ?? []).map((m: { id: string; mimeType: string }) => [m.id, m.mimeType]))
  const src = (s?: string): string | null => {
    if (!s) return null
    if (s.startsWith('asset:')) {
      const id = s.slice(6), b64 = data.mediaData?.[id]
      return b64 ? `data:${mime[id] ?? 'image/png'};base64,${b64}` : null
    }
    return s.startsWith('/') ? SITE + s : s
  }

  const targets = new Map<Platform, Data['targets'][number]>()
  for (const board of data.projectData) {
    const W = board.size.width, H = board.size.height
    const { platform, size, landscape } = sizeFor(W, H)
    const target = targets.get(platform) ?? { platform, size, landscape, slides: [] as Slide[] }
    targets.set(platform, target)

    const gradient = board.backgroundType === 'gradient' && board.backgroundGradient
    const slide: Slide = {
      id: crypto.randomUUID(),
      bg1: gradient ? gradient.color1 : board.backgroundColor,
      bg2: gradient ? gradient.color2 : board.backgroundColor,
      angle: gradient ? gradient.angle : 180,
      textColor: '#ffffff',
      device: poseFor(platform),
      image: null,
      outerImage: null,
      items: [],
      layers: [],
    }
    for (const e of board.elements as El[]) {
      // the box is size × scale, rotated about its centre
      const bw = e.size.width * (e.scale ?? 1), bh = e.size.height * (e.scale ?? 1)
      const cx = (e.position.x + bw / 2) / W, cy = (e.position.y + bh / 2) / H
      const box = { id: e.id, x: cx, y: cy, w: bw / W, h: bh / W, rotation: e.rotation || undefined }
      const alpha = e.opacity ?? 1

      if (e.type === 'device' || e.type === 'video-device') {
        const shot = src(e.screenshotSrc ?? e.posterSrc)
        const yaw = e.styleType?.endsWith('left') ? 20 : e.styleType?.endsWith('right') ? -20 : 0
        // their rotation is CSS's, clockwise; roll turns the 3D device the other way
        const pose = poseFor(platform, { model: modelFor(e.deviceType), size: bw / W, roll: -(e.rotation || 0), yaw })
        if (!slide.layers!.includes('device')) {
          // the first device is the slide's own; its x, y are offsets from the middle
          slide.device = { ...pose, x: cx - 0.5, y: cy - 0.5 }
          slide.image = shot
          slide.layers!.push('device')
          continue
        }
        slide.items!.push({ ...box, kind: 'device', rotation: undefined, device: pose, image: shot })
      } else if (e.type === 'text') {
        slide.items!.push({
          ...box, kind: 'text', text: e.content,
          size: e.fontSize / 0.3 / W, // they draw text at fontSize / 0.3 px
          font: `"${e.fontFamily}", ${FONT}`,
          weight: e.fontWeight === 'bold' ? 700 : parseInt(e.fontWeight) || 400,
          color: e.color, opacity: alpha < 1 ? alpha : undefined,
        })
      } else if (e.type === 'image') {
        slide.items!.push({ ...box, kind: 'image', image: src(e.imageSrc) })
      } else if (e.type === 'shape') {
        const shape = shapeOf(e)
        if (!shape) continue
        slide.items!.push({ ...box, ...shape, color: withAlpha(e.fillColor, alpha * (e.fillOpacity ?? 1)) })
      } else continue // gestures, sounds and videos have nothing to draw here
      slide.layers!.push(e.id)
    }
    target.slides.push(slide)
  }
  return { id: crypto.randomUUID(), name: data.name || 'Imported project', updated: Date.now(), targets: [...targets.values()], fonts: await fontsOf(data) }
}

/** The fonts its texts use, as project fonts: those the file carries, the rest from Google Fonts, where Open Screenshot Generator gets them. */
async function fontsOf(data: any): Promise<ProjectFont[]> {
  const families = new Set<string>(data.projectData.flatMap((b: { elements: El[] }) => b.elements.filter((e) => e.type === 'text').map((e) => e.fontFamily)))
  const carried = Object.fromEntries((data.fonts ?? []).map((f: El) => [f.family, data.fontData?.[f.id] && `data:${f.mimeType};base64,${data.fontData[f.id]}`]))
  // a system font isn't on Google Fonts and is left out; so is any font while offline
  const fonts = await Promise.all([...families].map(async (name) => {
    const font = carried[name] ?? await googleFont(name).catch(() => null)
    return font ? { name, data: font } : null
  }))
  return fonts.filter((f) => f !== null)
}

// shortcut: only the regular weight's Latin face, as a project font holds one file; fetch more if bold or non-Latin texts look off
async function googleFont(family: string) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}`)).text()
  const url = (css.match(/\/\* latin \*\/[^}]*?url\((.+?)\)/) ?? css.match(/url\((.+?)\)/))?.[1]
  return url ? toDataUrl(await (await fetch(url)).blob()) : null
}

/** The store size closest in shape to a board: exact sizes match, others (a watch, an Android phone) take the nearest. */
function sizeFor(w: number, h: number): { platform: Platform; size: SizeName; landscape?: boolean } {
  const landscape = w > h
  let best: SizeName = 'iPhone 6.9"', diff = Infinity
  for (const [name, [sw, sh]] of Object.entries(SIZES) as [SizeName, readonly [number, number]][]) {
    if (sw > sh !== landscape) continue
    const d = Math.abs(sw / sh - w / h) + (sw === w && sh === h ? -1 : 0)
    if (d < diff) [best, diff] = [name, d]
  }
  const platform = (Object.keys(PLATFORMS) as Platform[]).find((p) => PLATFORMS[p].sizes.includes(best))!
  return { platform, size: best }
}

// shortcut: phones (iPhone, Android, watch) all become the iPhone model; add models here if more get added to DEVICES
const modelFor = (t: string = '') =>
  /macbook|imac|desktop/.test(t) ? 'macbook-pro-14' : /ipad|tablet/.test(t) ? 'ipad-pro-13' : 'iphone-18-pro-max'

function shapeOf(e: El): Pick<Item, 'kind' | 'shape' | 'svg'> | undefined {
  const box = (e.specialProps?.viewBox ?? '0 0 100 100').split(/[\s,]+/).map(Number)
  const svg = (d: string) => ({ d, x0: box[0], y0: box[1], vw: box[2], vh: box[3], stroke: e.specialProps?.strokeOnly ? e.specialProps.baseStrokeWidth ?? 2 : undefined,
    evenodd: e.specialProps?.fillRule === 'evenodd' || undefined })
  switch (e.shapeType) {
    case 'rectangle': return { kind: 'rect' }
    case 'circle': return { kind: 'ellipse' }
    case 'star': case 'triangle': return { kind: 'shape', shape: e.shapeType }
    case 'custom-svg': return e.customPath ? { kind: 'shape', svg: svg(e.customPath) } : undefined
    case 'custom-polygon': {
      const n = e.customPoints ?? 6
      const pts = Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
        return `${(50 + 50 * Math.cos(a)).toFixed(2)} ${(50 + 50 * Math.sin(a)).toFixed(2)}`
      })
      box.splice(0, 4, 0, 0, 100, 100)
      return { kind: 'shape', svg: svg(`M${pts.join('L')}Z`) }
    }
  }
}

/** A #rrggbb color made see-through; other colors are kept as they are. */
const withAlpha = (c: string, a: number) =>
  a < 1 && /^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, '0') : c
