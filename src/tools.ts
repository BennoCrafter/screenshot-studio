// The MCP tools: each reads or changes the live project through the Host.

import { DEVICES, DEVICE_BY_ID } from './devices/models'
import { deleteProject, fontFamily, fontFrom, LANGUAGES, languagesOf, listProjects, loadImage, typeOfName, type Project } from './project'
import { FONTS, layersOf, localize, PLATFORMS, renderSlide, SIZES, THEMES, type Item, type Style, type Platform, type Slide, type Target } from './render'
import { labelOf } from './elements'
import type { DevicePose } from './devices/render3d'
import { ALL_PLATFORMS, BLANK, BUILT_IN, loadCustom, loadThemes, poseFor, saveTheme, toTarget } from './templates'
import type { Host } from './agent'

export type Json = Record<string, unknown>

/** A tool call the agent wants to make that needs the user's OK; the chat shows it and resolves it. */
export interface Approval { tool: string; input: Json; resolve: (ok: boolean) => void }
let askUser: ((a: Approval) => void) | null = null
export const onApproval = (fn: typeof askUser) => (askUser = fn)
export const APPROVE_TOOL = 'mcp__screenshot-studio__approve'

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export const text = (v: unknown): Content[] => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }]

function current(host: Host): Project {
  const p = host.project()
  if (!p) throw new Error('No project is open. Use open_project or create_project first.')
  return p
}

function targetOf(p: Project, platform?: string): Target {
  const t = platform ? p.targets.find((t) => t.platform === platform) : p.targets[0]
  if (!t) throw new Error(`The project has no ${platform} slides. It has: ${p.targets.map((t) => t.platform).join(', ')}`)
  return t
}

function slideAt(t: Target, index: number) {
  if (!t.slides[index]) throw new Error(`No slide ${index}; there are ${t.slides.length}`)
  return t.slides[index]
}

const withSlides = (p: Project, t: Target, slides: Slide[]): Project => ({ ...p, targets: p.targets.map((x) => (x === t ? { ...t, slides } : x)) })

const listing = (slides: Slide[]) => text(slides.map((s, i) => `${i}: ${labelOf(s)}`).join('\n'))

const templates = async () => [...BUILT_IN, ...(await loadCustom())]

/** The project as JSON, screenshots as true/false. */
const describe = (p: Project) => ({
  id: p.id,
  name: p.name,
  languages: languagesOf(p),
  fonts: p.fonts?.map((f) => ({ name: f.name, font: fontFamily(f.name) })),
  targets: p.targets.map((t) => ({
    ...t,
    slides: t.slides.map((s) => ({
      ...s, image: !!s.image, outerImage: !!s.outerImage,
      translations: s.translations && Object.fromEntries(Object.entries(s.translations).map(([l, t]) => [l, {
        ...t,
        shots: t.shots && Object.fromEntries(Object.entries(t.shots).map(([p, sh]) => [p, { image: !!sh.image, outerImage: !!sh.outerImage }])),
      }])),
      items: s.items?.map((i) => (i.kind === 'image' || i.kind === 'device' ? { ...i, image: !!i.image, outerImage: !!i.outerImage } : i)),
    })),
  })),
})

async function reference() {
  return {
    platforms: Object.fromEntries(ALL_PLATFORMS.map((p) => [p, { sizes: Object.fromEntries(PLATFORMS[p].sizes.map((n) => [n, SIZES[n]])) }])),
    devices: DEVICES.map((d) => ({
      id: d.id, label: d.label, family: d.family, finishes: d.finishes.map((f) => f.id),
      ...(d.fold && { foldable: true }), ...(d.laptop && { laptop: true }), ...(d.outer && { outerScreen: true }),
    })),
    themes: await loadThemes(),
    fonts: FONTS,
    languages: LANGUAGES,
    templates: (await templates()).map((t) => ({ id: t.id, name: t.name, description: t.description, platforms: Object.keys(t.targets) })),
  }
}

/** A file from a local path or a web URL (fetched natively, so other sites' CORS rules don't apply). */
async function fileFrom(path: string) {
  if (/^https?:\/\//.test(path)) {
    const { fetch } = await import('@tauri-apps/plugin-http')
    const res = await fetch(path)
    if (!res.ok) throw new Error(`Couldn't download ${path}: HTTP ${res.status}`)
    return res.blob()
  }
  const { readFile } = await import('@tauri-apps/plugin-fs')
  return new Blob([await readFile(path)], { type: typeOfName(path) })
}
const imageFrom = async (path: string) => loadImage(await fileFrom(path)).catch(() => { throw new Error(`${path} isn't an image`) })

/** A screenshot from the agent: a path/URL loads it, false/null removes it, anything else keeps the old one. */
const imageOr = async (v: unknown, kept: HTMLImageElement | null | undefined) =>
  typeof v === 'string' ? imageFrom(v) : v === false || v === null ? null : kept ?? null

/** One slide from the agent's JSON, merged over the slide with the same id (if any). */
async function slideFrom(platform: Platform, s: Json, was: Slide | undefined): Promise<Slide> {
  const device = poseFor(platform, { ...was?.device, ...(s.device as Json) })
  const model = DEVICE_BY_ID[device.model]
  if (!model) throw new Error(`Unknown device ${device.model}`)
  if (!model.finishes.some((f) => f.id === device.finish)) device.finish = model.finishes[0].id
  const translation = async ([l, t]: [string, Json]) => {
    const kept = was?.translations?.[l]?.shots ?? {}
    const given = (t.shots ?? {}) as Record<string, Json>
    const parts = new Set([...Object.keys(kept), ...Object.keys(given)])
    const shots = Object.fromEntries(await Promise.all([...parts].map(async (p) =>
      [p, { image: await imageOr(given[p]?.image, kept[p]?.image), outerImage: await imageOr(given[p]?.outerImage, kept[p]?.outerImage) }])))
    return [l, { ...(t as object), shots }]
  }
  const item = async (i: Json) => {
    const prev = was?.items?.find((w) => w.id === i.id)
    return {
      ...(i as unknown as Item),
      id: typeof i.id === 'string' ? i.id : crypto.randomUUID(),
      image: i.kind === 'image' || i.kind === 'device' ? await imageOr(i.image, prev?.image) : undefined,
      outerImage: i.kind === 'device' ? await imageOr(i.outerImage, prev?.outerImage) : undefined,
      device: i.kind === 'device' ? poseFor(platform, i.device as Partial<DevicePose>) : undefined,
    }
  }
  const slide: Slide = {
    ...THEMES.Paper, ...was, ...(s as Partial<Slide>),
    id: was?.id ?? crypto.randomUUID(),
    device,
    image: await imageOr(s.image, was?.image),
    outerImage: await imageOr(s.outerImage, was?.outerImage),
    translations: s.translations && typeof s.translations === 'object'
      ? Object.fromEntries(await Promise.all(Object.entries(s.translations as Record<string, Json>).map(translation)))
      : was?.translations,
    items: Array.isArray(s.items) ? await Promise.all((s.items as Json[]).map(item)) : was?.items,
  }
  // items not yet stacked go in front, so a new text shows without listing it in layers
  const layers = layersOf(slide)
  return { ...slide, layers: [...layers, ...(slide.items ?? []).map((i) => i.id).filter((id) => !layers.includes(id))] }
}

/** Rebuilds the project from the agent's JSON, filling in defaults and loading screenshots from paths. */
async function fromAgent(prev: Project, input: Json): Promise<Project> {
  const old = new Map(prev.targets.flatMap((t) => t.slides).map((s) => [s.id, s]))
  const targets = input.targets as Json[] | undefined
  if (!Array.isArray(targets) || !targets.length) throw new Error('targets must be a non-empty array')
  const languages = input.languages ?? languagesOf(prev)
  if (!Array.isArray(languages) || !languages.length || languages.some((l) => typeof l !== 'string' || !l.trim()))
    throw new Error('languages must be a non-empty array of language codes, such as the App Store ones in get_state')
  return {
    ...prev,
    name: typeof input.name === 'string' ? input.name : prev.name,
    languages,
    targets: await Promise.all(targets.map(async (t): Promise<Target> => {
      const platform = t.platform as Platform
      if (!PLATFORMS[platform]) throw new Error(`Unknown platform ${platform}`)
      const size = (t.size ?? PLATFORMS[platform].sizes[0]) as Target['size']
      if (!PLATFORMS[platform].sizes.includes(size)) throw new Error(`${size} is not a ${platform} size`)
      const slides = t.slides as Json[]
      if (!Array.isArray(slides) || !slides.length) throw new Error(`${platform}: slides must be a non-empty array`)
      return { platform, size, slides: await Promise.all(slides.map((s) => slideFrom(platform, s, old.get(s.id as string)))) }
    })),
  }
}

function applyTheme(host: Host, { bg1, bg2, angle, textColor }: Style, platform?: string) {
  const p = current(host)
  if (platform) targetOf(p, platform)
  host.setProject({
    ...p,
    targets: p.targets.map((t) => (platform && t.platform !== platform ? t : { ...t, slides: t.slides.map((s) => ({ ...s, bg1, bg2, angle, textColor })) })),
  })
}

const base64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const languageArg = { type: 'string', description: 'Language code from the project; defaults to its primary (first) language.' }
const platformArg = { type: 'string', enum: ALL_PLATFORMS, description: 'Defaults to the first platform in the project.' }

export const TOOLS: { name: string; description: string; inputSchema: Json; run: (host: Host, a: Json) => Promise<Content[]> }[] = [
  {
    name: 'get_state',
    description: 'The open project (or null), recent projects, and the reference data: platforms and their pixel sizes, device models and finishes, color themes and templates. Call this first. Screenshots show as true/false.',
    inputSchema: { type: 'object', properties: {} },
    run: async (host) => text({
      openProject: host.project() && describe(host.project()!),
      recentProjects: (await listProjects()).map(({ thumb: _t, ...p }) => p),
      reference: await reference(),
    }),
  },
  {
    name: 'update_project',
    description: `Replace the open project's name and targets with the given JSON, in the shape get_state returns. The app updates live and autosaves.
languages: App Store language codes; the first is the primary. Each target: { platform, size, slides }. Each slide: { id?, bg1, bg2 (hex), angle (gradient degrees), textColor (for texts without their own color), layers? (what's on the slide, back to front: "device" and item ids; leaving one out deletes it; new items go in front), items? (texts and other objects: { id?, kind: "text" | "rect" | "ellipse" | "image" | "device", x, y: centre as fractions of slide width/height, w, h: fractions of slide width (a text wraps at w), size?: text font size as a fraction of slide width (a headline is ~0.085, a subtitle ~0.042), font?: text CSS font family (default the system font; get_state lists the built-in ones under reference.fonts and the project's own under fonts; add_font adds one), weight?: text font weight (default 600; headlines 800, subtitles 500), opacity?: text, 0-1, text?, rotation?: degrees clockwise (not devices), color?, image?, device? (a device pose like the slide's; its size is a fraction of slide width), outerImage? }), device, image?, outerImage? }. Headlines and subtitles are just text items.
device: { model, finish, size (device width / slide width, ~0.3-1.2), yaw, pitch, roll (degrees), fold (degrees; 180 flat, 0 closed; foldables and Mac lid), x, y (offset of its centre from the slide's middle, as fraction of slide width/height), shadow?, reflections? (false turns off the drop shadow / glossy reflections) }. Omitted fields keep their value for an existing slide id, or get defaults.
Item text is the primary language's; translations: { "<code>": { items?: { <text item id>: text }, shots? } } holds the other languages'. shots: { "device" or a device item's id: { image?, outerImage? } } gives that language its own screenshots (same values as image above; omitted ones keep what's there, and a language without one shows the primary language's). Everything else is shared by all languages.
image / outerImage: true keeps the current screenshot, false removes it, a string is an absolute path or an http(s) URL of a PNG, JPEG, WebP or SVG to load. Slide order is array order; omit a slide to delete it, omit id to add one.`,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, languages: { type: 'array', items: { type: 'string' } }, targets: { type: 'array', items: { type: 'object' } } },
      required: ['targets'],
    },
    run: async (host, a) => {
      const p = await fromAgent(current(host), a)
      host.setProject(p)
      return text(describe(p))
    },
  },
  {
    name: 'render_slide',
    description: 'Look at a slide exactly as it exports, as a downscaled PNG. Use it to check your work.',
    inputSchema: { type: 'object', properties: { platform: platformArg, language: languageArg, index: { type: 'integer', description: '0-based slide index' } }, required: ['index'] },
    run: async (host, a) => {
      const t = targetOf(current(host), a.platform as string)
      const s = slideAt(t, a.index as number)
      const [w, h] = SIZES[t.size]
      return [{ type: 'image', data: await base64(await renderSlide(localize(s, a.language as string), SIZES[t.size], Math.min(1, 1000 / Math.max(w, h)))), mimeType: 'image/png' }]
    },
  },
  {
    name: 'move_slide',
    description: 'Move a slide to another position on one platform. Indexes are 0-based.',
    inputSchema: { type: 'object', properties: { platform: platformArg, from: { type: 'integer' }, to: { type: 'integer' } }, required: ['from', 'to'] },
    run: async (host, a) => {
      const p = current(host)
      const t = targetOf(p, a.platform as string)
      const [from, to] = [a.from as number, a.to as number]
      if (!t.slides[from] || to < 0 || to >= t.slides.length) throw new Error(`Indexes must be 0 to ${t.slides.length - 1}`)
      const slides = [...t.slides]
      slides.splice(to, 0, ...slides.splice(from, 1))
      host.setProject(withSlides(p, t, slides))
      return listing(slides)
    },
  },
  {
    name: 'delete_slide',
    description: 'Delete a slide from one platform by its 0-based index. A platform keeps at least one slide.',
    inputSchema: { type: 'object', properties: { platform: platformArg, index: { type: 'integer' } }, required: ['index'] },
    run: async (host, a) => {
      const p = current(host)
      const t = targetOf(p, a.platform as string)
      slideAt(t, a.index as number)
      if (t.slides.length === 1) throw new Error('This is the only slide; a platform needs at least one.')
      const slides = t.slides.filter((_, i) => i !== a.index)
      host.setProject(withSlides(p, t, slides))
      return listing(slides)
    },
  },
  {
    name: 'save_theme',
    description: 'Save a color theme of your own; it shows in the app\'s Themes dialog and can be applied with apply_theme. Saving under an existing name of your own replaces it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        bg1: { type: 'string', description: 'Gradient start, hex' },
        bg2: { type: 'string', description: 'Gradient end, hex' },
        angle: { type: 'number', description: 'Gradient direction in degrees; 180 is top to bottom' },
        textColor: { type: 'string', description: 'Hex' },
        apply: { type: 'boolean', description: 'Also apply it to every slide of the open project. Default false.' },
      },
      required: ['name', 'bg1', 'bg2', 'textColor'],
    },
    run: async (host, a) => {
      const hex = /^#[0-9a-f]{6}$/i
      for (const k of ['bg1', 'bg2', 'textColor']) if (!hex.test(a[k] as string)) throw new Error(`${k} must be a hex color like #1e3a8a`)
      const t = { name: String(a.name).trim(), bg1: a.bg1 as string, bg2: a.bg2 as string, angle: (a.angle as number) ?? 180, textColor: a.textColor as string }
      if (!t.name) throw new Error('name is empty')
      await saveTheme(t)
      if (a.apply) applyTheme(host, t)
      return text(`Saved ${t.name}${a.apply ? ' and applied it' : ''}.`)
    },
  },
  {
    name: 'apply_theme',
    description: 'Apply a theme (built-in or saved, by name from get_state) to every slide of the open project, or of one platform. Changes only the colors.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, platform: { ...platformArg, description: 'Omit for all platforms.' } }, required: ['name'] },
    run: async (host, a) => {
      const themes = await loadThemes()
      const t = themes.find((t) => t.name.toLowerCase() === String(a.name).toLowerCase())
      if (!t) throw new Error(`No theme ${a.name}. There are: ${themes.map((t) => t.name).join(', ')}`)
      applyTheme(host, t, a.platform as string | undefined)
      return text(`Applied ${t.name}.`)
    },
  },
  {
    name: 'export_pngs',
    description: 'Write every slide in every language at full App Store resolution as PNG files into a folder (created if missing). Returns the file paths.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Absolute folder path' }, platform: { ...platformArg, description: 'Omit to export all platforms.' } }, required: ['dir'] },
    run: async (host, a) => {
      const p = current(host)
      const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
      const dir = (a.dir as string).replace(/\/$/, '')
      await mkdir(dir, { recursive: true })
      const written: string[] = []
      for (const t of a.platform ? [targetOf(p, a.platform as string)] : p.targets) {
        const [w, h] = SIZES[t.size]
        for (const l of languagesOf(p)) {
          for (const [i, s] of t.slides.entries()) {
            const path = `${dir}/${p.name}-${t.platform}-${l}-${i + 1}-${w}x${h}.png`
            await writeFile(path, new Uint8Array(await (await renderSlide(localize(s, l), SIZES[t.size])).arrayBuffer()))
            written.push(path)
          }
        }
      }
      return text(written)
    },
  },
  {
    name: 'add_font',
    description: 'Add a font file (TTF, OTF, WOFF or WOFF2) to the open project, from an absolute path or an http(s) URL, e.g. a raw file from github.com/google/fonts. A font of the same name is replaced. Then set a text item\'s font to the returned value with update_project. The font is saved with the project.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Absolute path or http(s) URL of the font file' },
        name: { type: 'string', description: 'Font name; default the file name without extension' },
      },
      required: ['source'],
    },
    run: async (host, a) => {
      const p = current(host), source = String(a.source)
      const name = typeof a.name === 'string' && a.name.trim() ? a.name : decodeURIComponent(source.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[^.]+$/, '')
      const font = await fontFrom(await fileFrom(source), name)
      host.setProject({ ...p, fonts: [...(p.fonts ?? []).filter((f) => f.name !== font.name), font] })
      return text(`Added the font ${font.name}. Use it on a text item with "font": ${JSON.stringify(fontFamily(font.name))}`)
    },
  },
  {
    name: 'create_project',
    description: 'Create a project from a template and open it, replacing whatever is open (that one stays saved).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        template: { type: 'string', description: 'Template id from get_state; default "blank".' },
        platforms: { type: 'array', items: { type: 'string', enum: ALL_PLATFORMS }, description: "Default: all the template supports." },
      },
      required: ['name'],
    },
    run: async (host, a) => {
      const tpl = (await templates()).find((t) => t.id === (a.template ?? 'blank')) ?? BLANK
      const platforms = ((a.platforms as Platform[] | undefined) ?? ALL_PLATFORMS).filter((p) => tpl.targets[p])
      if (!platforms.length) throw new Error(`Template ${tpl.id} supports only ${Object.keys(tpl.targets).join(', ')}`)
      const p: Project = { id: crypto.randomUUID(), name: a.name as string, updated: Date.now(), targets: await Promise.all(platforms.map((pl) => toTarget(tpl.targets[pl]!))) }
      host.setProject(p)
      return text(describe(p))
    },
  },
  {
    name: 'open_project',
    description: 'Open a saved project by id (see recentProjects in get_state).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (host, a) => {
      await host.open(a.id as string)
      return text(describe(current(host)))
    },
  },
  {
    name: 'close_project',
    description: 'Close the open project and go back to the start page. It stays saved.',
    inputSchema: { type: 'object', properties: {} },
    run: async (host) => {
      host.close()
      return text('Closed.')
    },
  },
  {
    // The in-app agent calls this itself (--permission-prompt-tool) before a tool that needs permission.
    name: 'approve',
    description: 'Internal: the app uses this to ask the user for permission. Never call it yourself.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
    run: async (_host, a) => {
      const input = (a.input as Json) ?? {}
      const ok = askUser ? await new Promise<boolean>((resolve) => askUser!({ tool: a.tool_name as string, input, resolve })) : false
      return text(ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user declined this.' })
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a saved project for good. Ask the user first.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (host, a) => {
      if (host.project()?.id === a.id) host.close()
      await deleteProject(a.id as string)
      return text('Deleted.')
    },
  },
]
