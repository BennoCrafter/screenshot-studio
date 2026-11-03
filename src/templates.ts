// Templates describe a project per platform: canvas size plus each slide's colors, texts and other
// items, and device pose, and optionally its screenshots and images (as data URLs).

import { DEVICE_BY_ID, restFold } from './devices/models'
import { renderDevice, type DevicePose } from './devices/render3d'
import { isDesktop, openLink, saveFile } from './native'
import { imageUrl, loadImage } from './project'
import builtinTemplates from './builtin/templates.json'
import { FONT, PLATFORMS, SIZES, sizeOf, THEMES, wrap, type Item, type Platform, type SizeName, type Slide, type Style, type Target } from './render'

type Shot = string | null // a screenshot or image as a data URL, in templates that keep them
export type SlideData = Omit<Slide, 'id' | 'image' | 'outerImage' | 'translations' | 'items'> & {
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
  targets: Partial<Record<Platform, TargetData>>
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

interface Spec {
  style: Style
  title: string
  subtitle: string
  below?: boolean // words under the device instead of over it
  pose?: Partial<DevicePose> // y nudges the device from where the words leave room for it
}

let measure: CanvasRenderingContext2D | undefined

/** A built-in slide: a headline and subtitle stacked at the top (or bottom), the device filling the rest. */
function slide(platform: Platform, sizeName: SizeName, { style, title, subtitle, below, pose }: Spec): SlideData {
  const [w, h] = SIZES[sizeName]
  const unit = Math.min(w, h * 0.8) // portrait sizes by width; landscape (Mac) is held back by height
  const pad = h * 0.06, gap = unit * 0.025
  const ctx = (measure ??= document.createElement('canvas').getContext('2d')!)
  const block = (text: string, px: number, weight: number) => {
    ctx.font = `${weight} ${px}px ${FONT}`
    return wrap(ctx, text, w * 0.84).length * px * 1.15
  }
  const tH = block(title, unit * 0.085, 800), sH = block(subtitle, unit * 0.042, 500)
  const top = below ? h - pad - tH - gap - sH : pad
  const text = (t: string, px: number, weight: number, y: number, tall: number) =>
    ({ id: crypto.randomUUID(), kind: 'text' as const, text: t, x: 0.5, y: (y + tall / 2) / h, w: 0.84, h: 0, size: px / w, weight })
  const head = text(title, unit * 0.085, 800, top, tH)
  const sub = { ...text(subtitle, unit * 0.042, 500, top + tH + gap, sH), opacity: 0.85 }
  const device = poseFor(platform, pose)
  const m = DEVICE_BY_ID[device.model]
  // a laptop's shape depends so much on its lid that it's measured as drawn
  const tall = m.laptop ? renderDevice(device, null, null, device.size * w).height : (m.height / m.width) * device.size * w
  const devTop = below ? top - pad * 0.8 - tall : top + tH + gap + sH + pad * 0.8
  return { ...style, device: { ...device, y: device.y + (devTop + tall / 2) / h - 0.5 }, items: [head, sub], layers: [head.id, sub.id, 'device'] }
}

/** One design, laid out for each platform it supports. */
function design(id: string, name: string, description: string, specs: Spec[], platforms = ALL_PLATFORMS,
  perPlatform: Partial<Record<Platform, Partial<DevicePose>>> = {}): Template {
  const targets: Template['targets'] = {}
  for (const platform of platforms) {
    const size = PLATFORMS[platform].sizes[0]
    targets[platform] = { platform, size, slides: specs.map((s) => slide(platform, size, { ...s, pose: { ...s.pose, ...perPlatform[platform] } })) }
  }
  return { id, name, description, targets }
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
  ...Object.values(import.meta.glob<Template>('../templates/*.json', { eager: true, import: 'default' })),
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

// ---- sharing: a pull request adding a template to the repo's templates/ -------------

const REPO = 'BennoCrafter/screenshot-studio'

/** Opens a pull request that adds `t` to everyone's templates, through the user's GitHub CLI login. Returns its URL. */
export async function shareTemplate(t: Template) {
  const { invoke } = await import('@tauri-apps/api/core')
  const gh = (args: string[], input?: string) => invoke<string>('gh', { args, input })
  const me = await gh(['api', 'user', '--jq', '.login'])
  // others work in their fork (made if needed, brought up to date); the owner branches here
  const repo = me === REPO.split('/')[0] ? REPO : `${me}/screenshot-studio`
  if (repo !== REPO) {
    await gh(['repo', 'fork', REPO, '--clone=false'])
    await gh(['repo', 'sync', repo]).catch(() => {}) // already up to date
  }
  const sha = await gh(['api', `repos/${REPO}/git/ref/heads/main`, '--jq', '.object.sha'])
  const id = `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template'}-${crypto.randomUUID().slice(0, 6)}`
  const branch = `template/${id}`
  for (let n = 0; ; n++) { // a fork just made takes a few seconds to be ready
    try {
      await gh(['api', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`])
      break
    } catch (e) {
      if (n === 5) throw e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  const file = JSON.stringify({ id, name: t.name, description: t.description, targets: t.targets }, null, 2) + '\n'
  const content = (await toDataUrl(new Blob([file]))).split(',')[1]
  await gh(['api', '-X', 'PUT', `repos/${repo}/contents/templates/${id}.json`, '--input', '-'],
    JSON.stringify({ message: `Add template: ${t.name}`, content, branch }))
  return gh(['pr', 'create', '-R', REPO, '--head', repo === REPO ? branch : `${me}:${branch}`, '--base', 'main',
    '--title', `Add template: ${t.name}`, '--body', `${t.description}\n\nShared from Screenshot Studio.`])
}

// ---- themes: the built-in ones plus the user's own ----------------------------------

export type Theme = Style & { name: string; custom?: true }

export const loadThemes = async (): Promise<Theme[]> => [
  ...Object.entries(THEMES).map(([name, s]) => ({ name, ...s })),
  ...(await list<Theme>('themes.json')).map((t) => ({ ...t, custom: true as const })),
]
/** Adds or replaces (by name) one of the user's themes. */
export async function saveTheme(t: Theme) {
  const own = (await list<Theme>('themes.json')).filter((x) => x.name !== t.name)
  await write('themes.json', [...own, { ...t, custom: undefined }])
}
export const deleteTheme = async (name: string) => write('themes.json', (await list<Theme>('themes.json')).filter((x) => x.name !== name))
