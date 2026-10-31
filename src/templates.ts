// Templates describe a project per platform: canvas size plus each slide's text, colours,
// layout and device pose, and optionally its screenshots and images (as data URLs).

import { DEVICE_BY_ID, restFold } from './devices/models'
import type { DevicePose } from './devices/render3d'
import { isDesktop } from './native'
import { imageUrl, loadImage, toDataUrl } from './project'
import { PLATFORMS, THEMES, type Item, type Platform, type SizeName, type Slide, type Style, type Target } from './render'

type Shot = string | null // a screenshot or image as a data URL, in templates that keep them
export type SlideData = Omit<Slide, 'id' | 'image' | 'outerImage' | 'translations' | 'items'> & {
  image?: Shot
  outerImage?: Shot
  items?: (Omit<Item, 'image' | 'outerImage'> & { image?: Shot; outerImage?: Shot })[]
}
export interface TargetData {
  platform: Platform
  size: SizeName
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
  pose?: Partial<DevicePose>
}

/** One design, laid out for each platform it supports. */
function design(id: string, name: string, description: string, specs: Spec[], platforms = ALL_PLATFORMS,
  perPlatform: Partial<Record<Platform, Partial<DevicePose>>> = {}): Template {
  const targets: Template['targets'] = {}
  for (const platform of platforms) {
    targets[platform] = {
      platform,
      size: PLATFORMS[platform].sizes[0],
      slides: specs.map((s) => ({
        ...s.style,
        title: s.title,
        subtitle: s.subtitle,
        device: poseFor(platform, { ...s.pose, ...perPlatform[platform] }),
      })),
    }
  }
  return { id, name, description, targets }
}

export const BLANK = design('blank', 'Blank', 'One empty slide to start from.', [
  { style: THEMES.Paper, title: 'Your headline here', subtitle: 'A short line that explains the benefit' },
])

export const BUILT_IN: Template[] = [
  BLANK,
  design('classic', 'Classic', 'Headline on top, device front and centre.', [
    { style: THEMES.Midnight, title: 'Plan your day in seconds', subtitle: 'Everything in one calm place' },
    { style: THEMES.Midnight, title: 'Stay on track', subtitle: 'Gentle reminders, never noise' },
    { style: THEMES.Midnight, title: 'Share with your team', subtitle: 'Invite anyone in one tap' },
  ]),
  design('angled', 'Angled', 'Devices turned toward each other for movement.', [
    { style: THEMES.Sunrise, title: 'Capture every idea', subtitle: 'Fast, simple, always there', pose: { yaw: -24, roll: -6 } },
    { style: THEMES.Sunrise, title: 'Find it again', subtitle: 'Search that just works', pose: { yaw: 24, roll: 6 } },
    { style: THEMES.Sunrise, title: 'Works offline', subtitle: 'Your notes, wherever you are', pose: { yaw: -24, roll: -6 } },
  ], ALL_PLATFORMS, { iphone: { pitch: -8, finish: 'burgundy' }, ipad: { pitch: -8 } }),
  design('below', 'Text below', 'Calm colours, device on top, words underneath.', [
    { style: { ...THEMES.Mint, layout: 'text-bottom' }, title: 'Breathe easier', subtitle: 'Two minutes a day', pose: { y: 0.1 } },
    { style: { ...THEMES.Mint, layout: 'text-bottom' }, title: 'Sleep better', subtitle: 'Wind down with guided sounds', pose: { y: 0.1 } },
  ], ALL_PLATFORMS, { iphone: { model: 'iphone-17-pro', finish: 'silver' }, mac: { finish: 'silver' } }),
  design('duo', 'iPhone Duo', 'Open and folded views of the foldable iPhone.', [
    { style: THEMES.Ocean, title: 'Made for the big screen', subtitle: 'Two panes, side by side', pose: { model: 'iphone-duo', finish: 'night-sky', size: 0.9, fold: 150, yaw: -10, pitch: 6 } },
    { style: THEMES.Ocean, title: 'Fold it away', subtitle: 'Everything on the outside too', pose: { model: 'iphone-duo', finish: 'night-sky', size: 1.2, fold: 0, yaw: -20, pitch: 4 } },
  ], ['duo']),
  // shared by the community: templates/*.json in the repo, added by the app's pull requests
  ...Object.values(import.meta.glob<Template>('../templates/*.json', { eager: true, import: 'default' })),
]

const fromUrl = async (u?: Shot) => (u ? loadImage(await (await fetch(u)).blob()) : null)

/** Slides for a target, with the template's own screenshots. */
export async function toTarget(data: TargetData): Promise<Target> {
  return {
    platform: data.platform,
    size: data.size,
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

/** A new platform's set copied from an existing one: same words and colours, that platform's device. */
export function adaptTarget(from: Target, platform: Platform): Target {
  return {
    platform,
    size: PLATFORMS[platform].sizes[0],
    slides: from.slides.map((s) => ({
      ...s,
      id: crypto.randomUUID(),
      image: null,
      outerImage: null,
      device: poseFor(platform, { yaw: s.device.yaw, roll: s.device.roll }),
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
