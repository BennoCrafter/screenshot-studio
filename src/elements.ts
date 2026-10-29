// What can be done to one element of a slide, whichever kind it is. Each returns a patch for the slide.

import type { DevicePose } from './devices/render3d'
import { BUILT_IN_PARTS, layersOf, NO_BOX, type Item, type Part, type Slide, type TextPart } from './render'

export const itemOf = (s: Slide, p: Part) => s.items?.find((i) => i.id === p)
export const isTextPart = (p: Part): p is TextPart => p === 'title' || p === 'subtitle'
export const isText = (s: Slide, p: Part) => isTextPart(p) || itemOf(s, p)?.kind === 'text'

export const isDevice = (s: Slide, p: Part) => p === 'device' || itemOf(s, p)?.kind === 'device'

/** A device element's pose and screenshots: the slide's own device, or an added one. */
export type Shot = { device: DevicePose; image: HTMLImageElement | null; outerImage: HTMLImageElement | null }
export function shotOf(s: Slide, p: Part): Shot {
  const i = p === 'device' ? undefined : itemOf(s, p)
  return i?.device ? { device: i.device, image: i.image ?? null, outerImage: i.outerImage ?? null } : s
}
export const withShot = (s: Slide, p: Part, patch: Partial<Shot>): Partial<Slide> =>
  p === 'device' ? patch : withItem(s, p, (i) => ({ ...i, ...patch }))

const withItem = (s: Slide, id: Part, fn: (i: Item) => Item): Partial<Slide> =>
  ({ items: s.items?.map((i) => (i.id === id ? fn(i) : i)) })

export function partName(s: Slide, p: Part) {
  if (p === 'title') return 'Headline'
  if (p === 'subtitle') return 'Subtitle'
  if (p === 'device') return 'Device'
  const i = itemOf(s, p)
  if (i?.kind === 'text') return i.text?.trim().split('\n')[0].slice(0, 24) || 'Text'
  return { rect: 'Rectangle', ellipse: 'Ellipse', image: 'Image', text: 'Text', device: 'Device' }[i?.kind ?? 'text']
}

/** `p` moved by (dx, dy), fractions of the slide, from where it was in `s0`. */
export function moved(s0: Slide, s: Slide, p: Part, dx: number, dy: number): Partial<Slide> {
  if (p === 'device') return { device: { ...s.device, x: s0.device.x + dx, y: s0.device.y + dy } }
  if (isTextPart(p)) {
    const b = s0[`${p}Box`] ?? NO_BOX
    return { [`${p}Box`]: { ...(s[`${p}Box`] ?? NO_BOX), x: b.x + dx, y: b.y + dy } }
  }
  const i0 = itemOf(s0, p)
  return i0 ? withItem(s, p, (i) => ({ ...i, x: i0.x + dx, y: i0.y + dy })) : {}
}

/** `p` at `ratio` times the size it had in `s0`. */
export function resized(s0: Slide, s: Slide, p: Part, ratio: number): Partial<Slide> {
  const r = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * ratio * 1000) / 1000))
  if (p === 'device') return { device: { ...s.device, size: r(s0.device.size, 0.1, 2) } }
  if (isTextPart(p)) {
    const b = s0[`${p}Box`] ?? NO_BOX
    return { [`${p}Box`]: { ...(s[`${p}Box`] ?? NO_BOX), scale: r(b.scale, 0.2, 4) } }
  }
  const i0 = itemOf(s0, p)
  if (i0?.device) return withItem(s, p, (i) => ({ ...i, device: { ...i.device!, size: r(i0.device!.size, 0.05, 2) } }))
  return i0 ? withItem(s, p, (i) => ({ ...i, w: r(i0.w, 0.02, 3), h: r(i0.h, 0.02, 3), size: i0.size && r(i0.size, 0.005, 0.5) })) : {}
}

/** `p` back where the layout puts it (built-ins) or in the middle (items). */
export function reset(s: Slide, p: Part): Partial<Slide> {
  if (p === 'device') return { device: { ...s.device, x: 0, y: 0 } }
  if (isTextPart(p)) return { [`${p}Box`]: undefined }
  return withItem(s, p, (i) => ({ ...i, x: 0.5, y: 0.5 }))
}

export const removed = (s: Slide, p: Part): Partial<Slide> =>
  ({ layers: layersOf(s).filter((x) => x !== p), items: s.items?.filter((i) => i.id !== p) })

/** An item (or a deleted built-in) put back on the slide, in front. */
export function added(s: Slide, p: Part | Item): Partial<Slide> {
  const id = typeof p === 'string' ? p : p.id
  return {
    layers: [...layersOf(s).filter((x) => x !== id), id],
    ...(typeof p === 'string' ? {} : { items: [...(s.items ?? []), p] }),
  }
}

export const missingBuiltIns = (s: Slide) => BUILT_IN_PARTS.filter((p) => !layersOf(s).includes(p))

/** `p`'s text set to `text`, in `lang` (undefined for the primary language). */
export function withText(s: Slide, p: Part, text: string, lang?: string): Partial<Slide> {
  if (!lang) return isTextPart(p) ? { [p]: text } : withItem(s, p, (i) => ({ ...i, text }))
  const t = s.translations?.[lang] ?? { title: '', subtitle: '' }
  const next = isTextPart(p) ? { ...t, [p]: text } : { ...t, items: { ...t.items, [p]: text } }
  return { translations: { ...s.translations, [lang]: next } }
}

/** `part` moved to position `i` in the slide's back-to-front order. */
export function restack(s: Slide, part: Part, i: (now: number) => number): Partial<Slide> {
  const layers = layersOf(s), rest = layers.filter((p) => p !== part)
  rest.splice(Math.min(rest.length, Math.max(0, i(layers.indexOf(part)))), 0, part)
  return { layers: rest }
}

/** A new object of `kind`, in the middle of the slide; a device takes `pose`. */
export function newItem(kind: Item['kind'], image?: HTMLImageElement, pose?: DevicePose): Item {
  const base = { id: crypto.randomUUID(), kind, x: 0.5, y: 0.5 }
  if (kind === 'device' && pose) return { ...base, w: 0, h: 0, device: pose, image: null, outerImage: null }
  if (kind === 'text') return { ...base, w: 0.7, h: 0, size: 0.05, text: 'Text' }
  if (kind === 'image' && image) return { ...base, w: 0.4, h: (0.4 * image.naturalHeight) / image.naturalWidth, image }
  return { ...base, w: 0.3, h: 0.3, color: '#ffffff' }
}
