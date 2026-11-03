// Open Screenshot Generator (openscrgen.app) projects and templates, read as a project here. Its files hold the
// artboards as `projectData`: elements placed by their top-left corner in board px, uploads as `asset:<id>` in `mediaData`.

import { toDataUrl, type ProjectFont, type WithImages } from './project'
import { FONT, PLATFORMS, SIZES, type Item, type Platform, type SizeName } from './render'
import type { DevicePose } from './devices/render3d'
import { poseFor, type Template } from './templates'

type Data = WithImages<string | null>
type Slide = Data['targets'][number]['slides'][number]
type El = Record<string, any> // shortcut: their element types are loose and many; read only the fields mapped below

const SITE = 'https://editor.openscrgen.app' // their built-in templates point at screenshots under /data/projects/

/** True for a file Open Screenshot Generator saved or ships as a template. */
export const isOpenScrGen = (data: any) => Array.isArray(data?.projectData)

// shortcut: their catalog, copied from the editor's bundle (it has no index file); refresh when they add templates
const PHONE = ['somnia-sleep', 'kassa-money', 'pixara-ai', 'amoura-dating', 'scrappi-journal', 'plannio-student', 'calora-macros', 'puzzlo-word',
  'sproutly-parenting', 'zapio-remote', 'runzo-coach', 'nookly-focus', 'playpop-intro', 'lotus-calm', 'cvcraft-resume', 'nutrio-fitness', 'zenfit-yoga',
  'blogio-articles', 'breathora-breathing', 'vowly-wedding', 'verda-eco', 'connectly-chat', 'budgetly-finance', 'listly-tasks', 'inboxly-mail',
  'darzi-studio', 'beauty-glam', 'castique-podcast', 'inquira', 'zyluxe-beauty', 'nexmind', 'endless-communities', 'kicksy-sneakers', 'endless-podcasts',
  'answerly-ai', 'lumina-search', 'streamio-movies', 'readly-books', 'luxe-glow', 'cryptix', 'feasto', 'storybuzz-kids', 'trackio-fitness',
  'streamio-binge', 'roomora-home', 'playverse-games', 'voyago-travel', 'finexa-crypto', 'flixio-kids', 'listenly-audio', 'tripora-travel', 'tunio-music',
  'coinly-crypto', 'stockio-invest', 'threadly-social', 'beatforge-studio', 'podly-podcasts', 'cinevault-stream', 'sereno-mind', 'droply-habits',
  'zeeb-fashion', 'lingua-learn']
const MAC = ['mac-flowdesk', 'mac-pulseform', 'mac-skyfit', 'mac-inkpress', 'mac-everglade', 'mac-festivo', 'mac-terra', 'mac-loopchat', 'mac-ledgerly',
  'mac-boardly', 'mac-postbox', 'mac-atelier']

export interface StoreEntry { file: string; platform: Platform; preview: string }
const entries = (phone: string[], mac: string[]): StoreEntry[] =>
  [...phone.map((file) => ({ file, platform: 'iphone' as Platform })), ...mac.map((file) => ({ file, platform: 'mac' as Platform }))]
    .map((t) => ({ ...t, preview: `${SITE}/data/projects/previews/${t.file}.png` }))

/** Their built-in templates: file name, platform and picture of its screens. */
export const STORE = entries(PHONE, MAC)

let latest: Promise<StoreEntry[]> | undefined
/** Their catalog as their editor lists it now, read from its page script; the copy above when that fails or changes shape. */
export const loadStore = () => (latest ??= (async () => {
  const html = await (await fetch(SITE)).text()
  const page = html.match(/\/_next\/static\/chunks\/app\/page-[\w-]+\.js/)?.[0]
  if (!page) return STORE
  const js = await (await fetch(SITE + page)).text()
  const files = (id: string) => [...(js.match(new RegExp(`\\{id:"${id}",label:[^]*?files:\\[([^\\]]*)\\]`))?.[1].matchAll(/"([\w-]+)\.json"/g) ?? [])].map((m) => m[1])
  const phone = files('screenshots'), mac = files('mac')
  return phone.length && mac.length ? entries(phone, mac) : STORE
})().catch(() => STORE))

const fetched = new Map<string, Promise<Template>>()
/** One of their built-in templates as a template here, its screenshots still on their site. */
export const storeTemplate = (file: string) => {
  if (!fetched.has(file)) {
    const t = fetch(`${SITE}/data/projects/${file}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${file}: ${r.status}`))))
      .then(async (data) => ({ ...asTemplate(await fromOpenScrGen(data), data.description ?? '', 'Open Screenshot Generator'), id: `openscrgen-${file}` }))
    t.catch(() => fetched.delete(file)) // try again next time, once back online
    fetched.set(file, t)
  }
  return fetched.get(file)!
}

/** A converted project as a template. */
export const asTemplate = (project: Data, description: string, author: string): Template => ({
  id: `openscrgen-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'openscrgen'}`,
  name: project.name, description, author,
  targets: Object.fromEntries(project.targets.map(({ slides, ...t }) => [t.platform, { ...t, slides: slides.map(({ id: _, ...s }) => s) }])),
  fonts: project.fonts,
})

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
        const model = modelFor(e.deviceType)
        // their rotation is CSS's, clockwise; roll turns the 3D device the other way
        // their laptop pictures are mostly margin and perspective: the lid is about 70% of the picture's width in every pose
        const pose = poseFor(platform, { model, roll: -(e.rotation || 0), ...turnOf(e, model), size: (bw / W) * (model === 'macbook-pro-14' ? 0.7 : 1) })
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

// Their 3D laptops are pictures in five poses, each turned to the left or right; these are our angles that look like them.
// Pitch is on top of the lid's 110° opening, which alone shows the keyboard from 20° above: front shows it from about 7°.
const POSES: Record<string, { yaw: number; pitch: number }> = {
  front: { yaw: 0, pitch: -13 }, upright: { yaw: 25, pitch: -10 }, side: { yaw: 38, pitch: -10 }, tilted: { yaw: 25, pitch: 19 }, reclined: { yaw: 25, pitch: 40 },
}
/** Yaw (and pitch for laptops) for their style: '3d-left' turns the device's left side to us, which is a positive yaw. */
function turnOf(e: El, model: string): Partial<DevicePose> {
  const side = e.styleType?.endsWith('left') ? 1 : e.styleType?.endsWith('right') ? -1 : 0
  if (!side) return {}
  if (model !== 'macbook-pro-14') return { yaw: 20 * side }
  const { yaw, pitch } = POSES[e.pose3d] ?? POSES.upright
  return { yaw: yaw * side, pitch, ...(e.frameColor3d && { finish: e.frameColor3d === 'white' ? 'silver' : 'space-black' }) }
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
