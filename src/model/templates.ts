// Templates describe a project per platform: canvas size plus each slide's colors, texts and other
// items, and device pose, and optionally its screenshots and images (as data URLs).

import { useEffect, useState } from 'react'
import { DEVICE_BY_ID, restFold } from '../devices/models'
import { renderDevice, type DevicePose } from '../devices/render3d'
import { isDesktop, openLink, saveFile } from '../lib/native'
import { imageUrl, loadImage, type ProjectFont } from './project'
import builtinTemplates from '../builtin/templates.json'
import { FONT, PLATFORMS, SIZES, sizeOf, THEMES, wrap, type Item, type Platform, type SizeName, type Slide, type Style, type Target } from './render'

type Shot = string | null // a screenshot or image as a data URL, in templates that keep them
type SlideData = Omit<Slide, 'id' | 'image' | 'outerImage' | 'translations' | 'items'> & {
  image?: Shot
  outerImage?: Shot
  items?: (Omit<Item, 'image' | 'outerImage'> & { image?: Shot; outerImage?: Shot })[]
}
export interface TargetData {
  platform: Platform
  size: SizeName
  landscape?: boolean
  slides: SlideData[]
}

export interface Template {
  id: string
  name: string
  description: string
  author?: string // who made it, shown on its card
  targets: Partial<Record<Platform, TargetData>>
  fonts?: ProjectFont[] // fonts its texts use, given to projects made from it
  custom?: boolean
}

export const ALL_PLATFORMS = Object.keys(PLATFORMS) as Platform[]

/** A device pose for `platform`, with the pose bits a template asks for on top. */
export function poseFor(platform: Platform, p: Partial<DevicePose> = {}): DevicePose {
  const base = { ...PLATFORMS[platform].device, ...p }
  return {
    model: 'iphone-18-pro-max', finish: '', yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, size: 0.74,
    fold: restFold(DEVICE_BY_ID[base.model ?? 'iphone-18-pro-max']),
    ...base,
  }
}

/** Decoration from builtin/templates.json: x, y are fractions of the slide; w, h, size and a device's size, of its short side. */
type Extra = Partial<Omit<Item, 'id' | 'image' | 'outerImage' | 'device'>> & {
  kind: Item['kind']
  pose?: Partial<DevicePose> // devices
  front?: boolean // over the words and device instead of behind them
}

interface Spec {
  style: Style
  title: string
  subtitle: string
  below?: boolean // words under the device instead of over it
  hero?: boolean // words only, larger, in the middle: no device
  label?: string // a small tag in a chip over the headline
  accent?: string // the chip's color, the theme's text color if unset
  extras?: Extra[]
  pose?: Partial<DevicePose> // y nudges the device from where the words leave room for it
}

let measure: CanvasRenderingContext2D | undefined

/** A built-in slide: a headline and subtitle stacked at the top (or bottom), the device filling the rest. */
function slide(platform: Platform, sizeName: SizeName, { style, title, subtitle, below, hero, label, accent, extras = [], pose }: Spec): SlideData {
  const [w, h] = SIZES[sizeName]
  const unit = Math.min(w, h * 0.8) // portrait sizes by width; landscape (Mac) is held back by height
  const pad = h * 0.06, gap = unit * 0.025
  const ctx = (measure ??= document.createElement('canvas').getContext('2d')!)
  const block = (text: string, px: number, weight: number) => {
    ctx.font = `${weight} ${px}px ${FONT}`
    return wrap(ctx, text, w * 0.84).length * px * 1.15
  }
  const tPx = unit * (hero ? 0.12 : 0.085), lPx = unit * 0.032
  const chipH = label ? lPx * 2.2 : 0, chipGap = label ? gap * 1.6 : 0
  const tH = block(title, tPx, 800), sH = block(subtitle, unit * 0.042, 500)
  const words = chipH + chipGap + tH + gap + sH
  const top = hero ? h * 0.46 - words / 2 : below ? h - pad - words : pad
  const text = (t: string, px: number, weight: number, y: number, tall: number) =>
    ({ id: crypto.randomUUID(), kind: 'text' as const, text: t, x: 0.5, y: (y + tall / 2) / h, w: 0.84, h: 0, size: px / w, weight })
  const head = text(title, tPx, 800, top + chipH + chipGap, tH)
  const sub = { ...text(subtitle, unit * 0.042, 500, top + chipH + chipGap + tH + gap, sH), opacity: 0.85 }
  const chip = []
  if (label) {
    const tag = label.toUpperCase()
    ctx.font = `700 ${lPx}px ${FONT}`
    const cw = ctx.measureText(tag).width + lPx * 2.4
    chip.push({ id: crypto.randomUUID(), kind: 'rect' as const, x: 0.5, y: (top + chipH / 2) / h, w: cw / w, h: chipH / w, color: accent ?? style.textColor },
      { ...text(tag, lPx, 700, top + (chipH - lPx * 1.15) / 2, lPx * 1.15), w: cw / w, color: style.bg1 })
  }
  const k = unit / w // short-side fractions to width fractions
  const extra = ({ pose: p, front: _, ...e }: Extra) => ({
    x: 0.5, y: 0.5, ...e, id: crypto.randomUUID(), w: (e.w ?? 0) * k, h: (e.h ?? 0) * k,
    ...(e.size != null && { size: e.size * k }), ...(p && { device: poseFor(platform, { ...p, size: (p.size ?? 0.6) * k }) }),
  })
  const back = extras.filter((e) => !e.front).map(extra), front = extras.filter((e) => e.front).map(extra)
  const device = poseFor(platform, pose)
  const m = DEVICE_BY_ID[device.model]
  // a laptop's shape depends so much on its lid that it's measured as drawn
  const tall = m.laptop ? renderDevice(device, null, null, device.size * w).height : (m.height / m.width) * device.size * w
  const devTop = below ? top - pad * 0.8 - tall : top + words + pad * 0.8
  const items = [...back, ...chip, head, sub, ...front]
  const layers: string[] = [...[...back, ...chip, head, sub].map((i) => i.id), ...(hero ? [] : ['device']), ...front.map((i) => i.id)]
  return { ...style, device: { ...device, y: device.y + (devTop + tall / 2) / h - 0.5 }, items, layers }
}

/** One design, laid out for each platform it supports. */
function design(id: string, name: string, description: string, specs: Spec[], platforms = ALL_PLATFORMS,
  perPlatform: Partial<Record<Platform, Partial<DevicePose>>> = {}): Template {
  const targets: Template['targets'] = {}
  for (const platform of platforms) {
    const size = PLATFORMS[platform].sizes[0]
    targets[platform] = { platform, size, slides: specs.map((s) => slide(platform, size, { ...s, pose: { ...s.pose, ...perPlatform[platform] } })) }
  }
  return { id, name, description, author: 'Screenshot Studio', targets }
}

/** A built-in design as builtin/templates.json describes it; each slide takes the template's theme. */
interface Design {
  id: string
  name: string
  description: string
  theme: string // a name in THEMES
  platforms?: Platform[] // all if unset
  perPlatform?: Partial<Record<Platform, Partial<DevicePose>>>
  slides: Omit<Spec, 'style'>[]
}

export const BUILT_IN: Template[] = [
  ...(builtinTemplates as Design[]).map((d) =>
    design(d.id, d.name, d.description, d.slides.map((s) => ({ ...s, style: THEMES[d.theme] })), d.platforms, d.perPlatform)),
  // shared by the community: templates/*.json in the repo, added by the app's pull requests
  ...Object.values(import.meta.glob<Template>('../../templates/*.json', { eager: true, import: 'default' })),
]
export const BLANK = BUILT_IN.find((t) => t.id === 'blank')!

const fromUrl = async (u?: Shot) => (u ? loadImage(await (await fetch(u)).blob()) : null)

/** Slides for a target, with the template's own screenshots. */
export async function toTarget(data: TargetData): Promise<Target> {
  return {
    platform: data.platform,
    size: data.size,
    landscape: data.landscape,
    slides: await Promise.all(data.slides.map(async (d) => ({
      ...d,
      device: { ...d.device },
      id: crypto.randomUUID(),
      image: await fromUrl(d.image),
      outerImage: await fromUrl(d.outerImage),
      items: d.items && await Promise.all(d.items.map(async (i) => ({ ...i, image: await fromUrl(i.image), outerImage: await fromUrl(i.outerImage) }))),
    }))),
  }
}

// texts keep their size against the slide's short side, so a phone's headline isn't huge on a Mac
const unit = ([w, h]: readonly [number, number]) => Math.min(w, h * 0.8) / w

/** The set turned between portrait and landscape: everything sized against the slide keeps its size against the short side. */
export function rotateTarget(t: Target): Target {
  const landscape = !t.landscape
  const k = unit(sizeOf({ ...t, landscape })) / unit(sizeOf(t))
  const scale = <P extends { size: number }>(d: P) => ({ ...d, size: d.size * k })
  return {
    ...t,
    landscape,
    slides: t.slides.map((s) => ({
      ...s,
      device: scale(s.device),
      items: s.items?.map((i) => ({ ...i, w: i.w * k, h: i.h * k, ...(i.size != null ? { size: i.size * k } : {}), ...(i.device ? { device: scale(i.device) } : {}) })),
    })),
  }
}

/** A new platform's set copied from an existing one: same words and colors, that platform's device. */
export function adaptTarget(from: Target, platform: Platform): Target {
  const size = PLATFORMS[platform].sizes[0]
  const k = unit(SIZES[size]) / unit(sizeOf(from))
  return {
    platform,
    size,
    slides: from.slides.map((s) => ({
      ...s,
      id: crypto.randomUUID(),
      image: null,
      outerImage: null,
      device: poseFor(platform, { yaw: s.device.yaw, roll: s.device.roll }),
      items: s.items?.map((i) => (i.kind === 'text' ? { ...i, w: i.w * k, size: (i.size ?? 0.05) * k } : i)),
    })),
  }
}

/** A slide as template data; without `shots`, its screenshots and added images stay behind. */
export async function toData({ id: _id, image, outerImage, translations: _t, items, ...data }: Slide, shots: boolean): Promise<SlideData> {
  const url = async (i?: HTMLImageElement | null) => (shots && i ? imageUrl(i) : null)
  const gone = new Set(shots ? [] : items?.filter((i) => i.kind === 'image').map((i) => i.id))
  return {
    ...data,
    image: await url(image),
    outerImage: await url(outerImage),
    items: items && await Promise.all(items.filter((i) => !gone.has(i.id))
      .map(async ({ image, outerImage, ...i }) => ({ ...i, image: await url(image), outerImage: await url(outerImage) }))),
    layers: data.layers?.filter((p) => !gone.has(p)),
  }
}

// ---- saved templates --------------------------------------------------------------

// desktop: files in the app data folder, next to projects/; browser: localStorage
async function read(file: string): Promise<string | null> {
  if (!isDesktop) return localStorage.getItem(`screenshot-studio:${file}`)
  const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const opt = { baseDir: BaseDirectory.AppData }
  return (await exists(file, opt)) ? readTextFile(file, opt) : null
}

async function write(file: string, list: unknown[]) {
  try {
    if (!isDesktop) return localStorage.setItem(`screenshot-studio:${file}`, JSON.stringify(list))
    const { BaseDirectory, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs')
    const opt = { baseDir: BaseDirectory.AppData }
    await mkdir('', { ...opt, recursive: true })
    await writeTextFile(file, JSON.stringify(list), opt)
  } catch {
    // storage full or blocked; it just won't persist
  }
}

const list = async <T,>(file: string): Promise<T[]> => {
  try {
    return JSON.parse((await read(file)) ?? '[]')
  } catch {
    return []
  }
}

export const loadCustom = async () => (await list<Template>('templates.json')).filter((t) => t.targets) // drop the older single-platform format
export const saveCustom = (all: Template[]) => write('templates.json', all)

/** Saved templates, kept in sync with storage (a file on the desktop, localStorage in the browser). */
export function useCustomTemplates() {
  const [custom, setCustom] = useState<Template[]>([])
  useEffect(() => {
    loadCustom().then(setCustom)
  }, [])
  const store = (list: Template[]) => {
    setCustom(list)
    saveCustom(list)
  }
  return [custom, store] as const
}

// ---- sharing: a file for the repo's templates/ (themes/), proposed through GitHub's web editor ----

const REPO = 'BennoCrafter/screenshot-studio'
const MAX_URL = 8000 // shortcut: a guess at what GitHub accepts; bigger files go through the upload page instead

/** Proposes `t` for everyone's templates: opens GitHub in the browser with the file filled in. Returns what to tell the user. */
export const shareTemplate = (t: Template) =>
  share('template', t.name, (id) => ({ id, name: t.name, author: t.author, description: t.description, targets: t.targets }))

/** The same for a theme, for everyone's built-in themes. */
export const shareTheme = ({ name, bg1, bg2, angle, textColor }: Theme) =>
  share('theme', name, () => ({ name, bg1, bg2, angle, textColor }))

// Nothing leaves the machine from here: the user reviews and submits on GitHub, which forks and opens the pull request.
async function share(kind: 'template' | 'theme', name: string, json: (id: string) => object) {
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || kind}-${crypto.randomUUID().slice(0, 6)}`
  const file = JSON.stringify(json(id), null, 2) + '\n'
  const url = `https://github.com/${REPO}/new/main?filename=${encodeURIComponent(`${kind}s/${id}.json`)}&value=${encodeURIComponent(file)}`
  if (url.length <= MAX_URL) {
    await openLink(url)
    return `Opened GitHub with the ${kind} filled in. Click “Commit changes” there to propose it.`
  }
  // too long for a link: save the file, then open the upload page to drop it in
  if (!(await saveFile(`${id}.json`, new Blob([file], { type: 'application/json' }), { name: 'JSON', extensions: ['json'] }))) return 'Not shared.'
  await openLink(`https://github.com/${REPO}/upload/main/${kind}s`)
  return `The ${kind} is too big for a link, so it was saved as ${id}.json. Drop that file on the GitHub page that just opened, then click “Commit changes”.`
}

// ---- themes: the built-in ones plus the user's own ----------------------------------

export type Theme = Style & { name: string; custom?: true }

export const loadThemes = async (): Promise<Theme[]> => [
  ...Object.entries(THEMES).map(([name, s]) => ({ name, ...s })),
  // shared by the community: themes/*.json in the repo, added by the app's pull requests
  ...Object.values(import.meta.glob<Theme>('../../themes/*.json', { eager: true, import: 'default' })),
  ...(await list<Theme>('themes.json')).map((t) => ({ ...t, custom: true as const })),
]
/** Adds or replaces (by name) one of the user's themes. */
export async function saveTheme(t: Theme) {
  const own = (await list<Theme>('themes.json')).filter((x) => x.name !== t.name)
  await write('themes.json', [...own, { ...t, custom: undefined }])
}
export const deleteTheme = async (name: string) => write('themes.json', (await list<Theme>('themes.json')).filter((x) => x.name !== name))
