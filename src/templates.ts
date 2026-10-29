// Templates describe a project per platform: canvas size plus each slide's text, colours,
// layout and device pose. Screenshots are never part of a template; applying one to an
// existing set keeps its screenshots by slide order.

import { DEVICE_BY_ID, restFold } from './devices/models'
import type { DevicePose } from './devices/render3d'
import { isDesktop } from './native'
import { PLATFORMS, THEMES, type Platform, type SizeName, type Slide, type Style, type Target } from './render'

export type SlideData = Omit<Slide, 'id' | 'image' | 'outerImage' | 'translations'>
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
  ], ['iphone']),
]

/** Slides for a target, keeping the screenshots already at the same positions. */
export function toTarget(data: TargetData, prev: Slide[] = []): Target {
  return {
    platform: data.platform,
    size: data.size,
    slides: data.slides.map((d, i) => ({
      ...d,
      device: { ...d.device },
      id: crypto.randomUUID(),
      image: prev[i]?.image ?? null,
      outerImage: prev[i]?.outerImage ?? null,
    })),
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

// added images and screenshots stay with the project; a template keeps everything else
export const toData = ({ id: _id, image: _i, outerImage: _o, translations: _t, ...data }: Slide): SlideData => {
  const gone = new Set(data.items?.filter((i) => i.kind === 'image').map((i) => i.id))
  return {
    ...data,
    items: data.items?.filter((i) => !gone.has(i.id)).map((i) => (i.kind === 'device' ? { ...i, image: null, outerImage: null } : i)),
    layers: data.layers?.filter((p) => !gone.has(p)),
  }
}

// ---- saved templates --------------------------------------------------------------

const KEY = 'screenshot-studio:templates'
const FILE = 'templates.json' // desktop: in the app data folder, next to projects/

async function read(): Promise<string | null> {
  if (!isDesktop) return localStorage.getItem(KEY)
  const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const opt = { baseDir: BaseDirectory.AppData }
  return (await exists(FILE, opt)) ? readTextFile(FILE, opt) : null
}

export async function loadCustom(): Promise<Template[]> {
  try {
    const list: Template[] = JSON.parse((await read()) ?? '[]')
    return list.filter((t) => t.targets) // drop the older single-platform format
  } catch {
    return []
  }
}

export async function saveCustom(list: Template[]) {
  try {
    if (!isDesktop) return localStorage.setItem(KEY, JSON.stringify(list))
    const { BaseDirectory, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs')
    const opt = { baseDir: BaseDirectory.AppData }
    await mkdir('', { ...opt, recursive: true })
    await writeTextFile(FILE, JSON.stringify(list), opt)
  } catch {
    // storage full or blocked; templates just won't persist
  }
}
