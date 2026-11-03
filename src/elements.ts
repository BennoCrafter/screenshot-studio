// What can be done to one element of a slide, whichever kind it is. Each returns a patch for the slide.

import type { DevicePose } from './devices/render3d'
import { layersOf, PLATFORMS, type Item, type Part, type Slide } from './render'
import type { Project } from './project'
import { SHAPES } from './shapes'

export const itemOf = (s: Slide, p: Part) => s.items?.find((i) => i.id === p)
export const isText = (s: Slide, p: Part) => itemOf(s, p)?.kind === 'text'
/** The slide's texts, back to front. */
export const textsOf = (s: Slide) => layersOf(s).map((p) => itemOf(s, p)).filter((i) => i?.kind === 'text') as Item[]
/** A short name for the slide: its first text's first line. */
export const labelOf = (s: Slide) => textsOf(s)[0]?.text?.trim().split('\n')[0] ?? ''

export const isDevice = (s: Slide, p: Part) => p === 'device' || itemOf(s, p)?.kind === 'device'
/** 'device' for the slide's own device too, so it groups with added ones. */
export const kindOf = (s: Slide, p: Part) => (p === 'device' ? 'device' : itemOf(s, p)?.kind)

/** A device element's pose and screenshots: the slide's own device, or an added one. */
export type Shot = { device: DevicePose; image: HTMLImageElement | null; outerImage: HTMLImageElement | null }
export function shotOf(s: Slide, p: Part): Shot {
  const i = p === 'device' ? undefined : itemOf(s, p)
  return i?.device ? { device: i.device, image: i.image ?? null, outerImage: i.outerImage ?? null } : s
}
/** A device element changed; in `lang` (undefined for the primary language) its screenshots are that language's own. */
export function withShot(s: Slide, p: Part, patch: Partial<Shot>, lang?: string): Partial<Slide> {
  const { device, ...shots } = patch
  const shared = p === 'device' ? (lang ? (device ? { device } : {}) : patch) : withItem(s, p, (i) => ({ ...i, ...(lang ? (device ? { device } : {}) : patch) }))
  if (!lang || !Object.keys(shots).length) return shared
  const t = s.translations?.[lang] ?? {}
  return { ...shared, translations: { ...s.translations, [lang]: { ...t, shots: { ...t.shots, [p]: { ...t.shots?.[p], ...shots } } } } }
}

/** The screenshot ID of an image or device element, if it has one. */
export const shotIdOf = (s: Slide, p: Part) => (p === 'device' ? s.shotId : itemOf(s, p)?.shotId)
export const withShotId = (s: Slide, p: Part, id: string): Partial<Slide> =>
  p === 'device' ? { shotId: id || undefined } : withItem(s, p, (i) => ({ ...i, shotId: id || undefined }))

/** Every element whose screenshot ID is in `images` gets that screenshot (in `lang`, if given); `done` says where. */
export function replaceShots(p: Project, images: Map<string, HTMLImageElement>, lang?: string) {
  const done: string[] = []
  const targets = p.targets.map((t) => ({
    ...t,
    slides: t.slides.map((s, i) => layersOf(s).reduce((s, part) => {
      const image = images.get(shotIdOf(s, part) ?? '')
      if (!image) return s
      done.push(`${shotIdOf(s, part)} → ${PLATFORMS[t.platform].label} slide ${i + 1} (${partName(s, part)})`)
      return { ...s, ...withShot(s, part, { image }, lang) }
    }, s)),
  }))
  return { project: { ...p, targets }, done }
}

const withItem = (s: Slide, id: Part, fn: (i: Item) => Item): Partial<Slide> =>
  ({ items: s.items?.map((i) => (i.id === id ? fn(i) : i)) })

export function partName(s: Slide, p: Part) {
  if (p === 'device') return 'Device'
  const i = itemOf(s, p)
  if (i?.kind === 'text') return i.text?.trim().split('\n')[0].slice(0, 24) || 'Text'
  if (i?.kind === 'shape') return SHAPES[i.shape ?? '']?.label ?? 'Shape'
  return { rect: 'Rectangle', ellipse: 'Ellipse', image: 'Image', text: 'Text', device: 'Device' }[i?.kind ?? 'text']
}

/** `p`'s centre in slide px, from the top left. */
export function positionOf(s: Slide, p: Part, [w, h]: readonly [number, number]) {
  if (p === 'device') return { x: w / 2 + s.device.x * w, y: h / 2 + s.device.y * h }
  const i = itemOf(s, p)
  return { x: (i?.x ?? 0) * w, y: (i?.y ?? 0) * h }
}

/** `p` moved by (dx, dy), fractions of the slide, from where it was in `s0`. */
export function moved(s0: Slide, s: Slide, p: Part, dx: number, dy: number): Partial<Slide> {
  if (p === 'device') return { device: { ...s.device, x: s0.device.x + dx, y: s0.device.y + dy } }
  const i0 = itemOf(s0, p)
  return i0 ? withItem(s, p, (i) => ({ ...i, x: i0.x + dx, y: i0.y + dy })) : {}
}

/** `p` at `ratio` times the size it had in `s0`. */
export function resized(s0: Slide, s: Slide, p: Part, ratio: number): Partial<Slide> {
  const r = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * ratio * 1000) / 1000))
  if (p === 'device') return { device: { ...s.device, size: r(s0.device.size, 0.1, 2) } }
  const i0 = itemOf(s0, p)
  if (i0?.device) return withItem(s, p, (i) => ({ ...i, device: { ...i.device!, size: r(i0.device!.size, 0.05, 2) } }))
  return i0 ? withItem(s, p, (i) => ({ ...i, w: r(i0.w, 0.02, 3), h: r(i0.h, 0.02, 3), size: i0.size && r(i0.size, 0.005, 0.5) })) : {}
}

/** A text, image or shape turned to `deg` degrees clockwise. */
export function rotated(s: Slide, p: Part, deg: number): Partial<Slide> {
  return withItem(s, p, (i) => ({ ...i, rotation: deg }))
}

/** `p` back in the middle of the slide. */
export function reset(s: Slide, p: Part): Partial<Slide> {
  if (p === 'device') return { device: { ...s.device, x: 0, y: 0 } }
  return withItem(s, p, (i) => ({ ...i, x: 0.5, y: 0.5 }))
}

export const removed = (s: Slide, p: Part): Partial<Slide> =>
  ({ layers: layersOf(s).filter((x) => x !== p), items: s.items?.filter((i) => i.id !== p) })

/** An item (or the slide's deleted device) put back on the slide, in front. */
export function added(s: Slide, p: Part | Item): Partial<Slide> {
  const id = typeof p === 'string' ? p : p.id
  return {
    layers: [...layersOf(s).filter((x) => x !== id), id],
    ...(typeof p === 'string' ? {} : { items: [...(s.items ?? []), p] }),
  }
}

/** `p`'s text set to `text`, in `lang` (undefined for the primary language). */
export function withText(s: Slide, p: Part, text: string, lang?: string): Partial<Slide> {
  if (!lang) return withItem(s, p, (i) => ({ ...i, text }))
  const t = s.translations?.[lang] ?? {}
  return { translations: { ...s.translations, [lang]: { ...t, items: { ...t.items, [p]: text } } } }
}

/** `part` moved to position `i` in the slide's back-to-front order. */
export function restack(s: Slide, part: Part, i: (now: number) => number): Partial<Slide> {
  const layers = layersOf(s), rest = layers.filter((p) => p !== part)
  rest.splice(Math.min(rest.length, Math.max(0, i(layers.indexOf(part)))), 0, part)
  return { layers: rest }
}

/** A new object of `kind`, in the middle of the slide; a device takes `pose`. */
export function newItem(kind: Item['kind'], image?: HTMLImageElement, pose?: DevicePose, shape?: string): Item {
  const base = { id: crypto.randomUUID(), kind, x: 0.5, y: 0.5 }
  if (kind === 'device' && pose) return { ...base, w: 0, h: 0, device: pose, image: null, outerImage: null }
  if (kind === 'text') return { ...base, w: 0.7, h: 0, size: 0.05, text: 'Text' }
  if (kind === 'image' && image) return { ...base, w: 0.4, h: (0.4 * image.naturalHeight) / image.naturalWidth, image }
  if (kind === 'shape') {
    const s = SHAPES[shape!], w = s.group === 'Icons' ? 0.15 : s.group === 'Badges' ? 0.5 : 0.3
    return { ...base, shape, w, h: (w * s.vh) / s.vw, color: s.color ?? '#ffffff' }
  }
  return { ...base, w: 0.3, h: 0.3, color: '#ffffff' }
}
