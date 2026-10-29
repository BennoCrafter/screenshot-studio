// Projects: several platform targets (iPhone, iPad, Mac) under one name. The desktop app keeps
// them as files in the app data folder (~/Library/Application Support/app.screenshotstudio.desktop
// on macOS); the browser keeps them in IndexedDB with their screenshots as Blobs.

import { isDesktop } from './native'
import type { Item, Platform, Slide, Target } from './render'

export interface Project {
  id: string
  name: string
  updated: number
  targets: Target[]
  languages?: string[] // App Store locales, first is the primary; missing means ['en']
  thumb?: string // small JPEG data URL of the first slide, for the start page
}

export const languagesOf = (p: Pick<Project, 'languages'>) => p.languages?.length ? p.languages : ['en']

/** Every App Store locale; projects can add others. */
export const LANGUAGES = ['ar', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en-AU', 'en-CA', 'en-GB', 'es', 'es-MX', 'fi', 'fr', 'fr-CA', 'he',
  'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sv', 'th', 'tr', 'uk', 'vi',
  'zh-Hans', 'zh-Hant']
/** A language's name in that language: Deutsch, English, 日本語. */
export function languageName(code: string) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
    return name[0].toLocaleUpperCase(code) + name.slice(1)
  } catch {
    return code // a custom language, kept as typed
  }
}

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'updated' | 'thumb'> & { platforms: Platform[] }

/** A project with its screenshots held as `I` (Blobs in IndexedDB, file names on disk, data URLs in a file). */
type WithImages<I> = Omit<Project, 'targets'> & {
  targets: (Omit<Target, 'slides'> & { slides: (Omit<Slide, 'image' | 'outerImage' | 'items'> & {
    image: I
    outerImage: I
    items?: (Omit<Item, 'image' | 'outerImage'> & { image?: I; outerImage?: I })[] // images and devices have them
  })[] })[]
}

const mapImages = async <A, B>(p: WithImages<A>, fn: (a: A) => B | Promise<B>): Promise<WithImages<B>> => ({
  ...p,
  targets: await Promise.all(p.targets.map(async (t) => ({
    ...t,
    slides: await Promise.all(t.slides.map(async (s) => ({
      ...s,
      image: await fn(s.image),
      outerImage: await fn(s.outerImage),
      items: s.items && await Promise.all(s.items.map(async ({ image, outerImage, ...i }) => ({
        ...i,
        ...(i.kind === 'image' || i.kind === 'device' ? { image: await fn(image ?? (null as A)) } : {}),
        ...(i.kind === 'device' ? { outerImage: await fn(outerImage ?? (null as A)) } : {}),
      }))),
    }))),
  }))),
})

const summary = ({ id, name, updated, thumb, targets }: WithImages<unknown>): ProjectSummary =>
  ({ id, name, updated, thumb, platforms: targets.map((t) => t.platform) })

// ---- images: keep each screenshot's Blob so it can be stored ----------------------

const blobs = new WeakMap<HTMLImageElement, Blob>()
const blobOf = (img: HTMLImageElement | null) => (img && blobs.get(img)) ?? null

export async function loadImage(blob: Blob) {
  const img = new Image()
  img.src = URL.createObjectURL(blob)
  await img.decode()
  blobs.set(img, blob)
  return img
}

// ---- IndexedDB (browser) ----------------------------------------------------------

const STORE = 'projects'
let opened: Promise<IDBDatabase> | undefined

function db() {
  return (opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('screenshot-studio', 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  return new Promise<T>((resolve, reject) => {
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const idb = {
  save: async (p: Project) => {
    const stored = await mapImages<HTMLImageElement | null, Blob | null>(p, blobOf)
    await run('readwrite', (s) => s.put(stored))
  },
  open: async (id: string): Promise<Project> =>
    mapImages(await run<WithImages<Blob | null>>('readonly', (s) => s.get(id)), (b) => (b ? loadImage(b) : null)),
  list: async () => (await run<WithImages<Blob | null>[]>('readonly', (s) => s.getAll())).map(summary),
  delete: (id: string) => run('readwrite', (s) => s.delete(id)),
}

// ---- files (desktop): projects/<id>/project.json plus one file per screenshot -----

const fs = () => import('@tauri-apps/plugin-fs')
const dirOf = (id: string) => `projects/${id}`
const names = new WeakMap<Blob, string>() // a screenshot's file name, so it's written only once

async function at() {
  const { BaseDirectory } = await fs()
  return { baseDir: BaseDirectory.AppData }
}

async function saveFiles(p: Project) {
  const { exists, mkdir, readDir, remove, rename, writeFile, writeTextFile } = await fs()
  const opt = await at()
  const dir = dirOf(p.id)
  await mkdir(dir, { ...opt, recursive: true })
  const used = new Set(['project.json'])
  const stored = await mapImages(p, async (img) => {
    const blob = blobOf(img)
    if (!blob) return null
    let name = names.get(blob)
    if (!name) names.set(blob, (name = `${crypto.randomUUID()}.${blob.type.split('/')[1] || 'png'}`))
    if (!(await exists(`${dir}/${name}`, opt))) await writeFile(`${dir}/${name}`, new Uint8Array(await blob.arrayBuffer()), opt)
    used.add(name)
    return name
  })
  // write then rename, so a crash mid-save never leaves a half-written project
  await writeTextFile(`${dir}/project.json.tmp`, JSON.stringify(stored), opt)
  await rename(`${dir}/project.json.tmp`, `${dir}/project.json`, { oldPathBaseDir: opt.baseDir, newPathBaseDir: opt.baseDir })
  for (const e of await readDir(dir, opt)) if (!used.has(e.name)) await remove(`${dir}/${e.name}`, opt)
}

async function readStored(id: string): Promise<WithImages<string | null>> {
  const { readTextFile } = await fs()
  return JSON.parse(await readTextFile(`${dirOf(id)}/project.json`, await at()))
}

// saves run one at a time: an older save's cleanup must not delete a newer save's screenshots
let saving = Promise.resolve()

const files = {
  save: (p: Project) => (saving = saving.catch(() => {}).then(() => saveFiles(p))),
  open: async (id: string): Promise<Project> => {
    const { readFile } = await fs()
    const opt = await at()
    return mapImages(await readStored(id), async (name) => {
      if (!name) return null
      const blob = new Blob([await readFile(`${dirOf(id)}/${name}`, opt)], { type: `image/${name.split('.').pop()}` })
      names.set(blob, name)
      return loadImage(blob)
    })
  },
  list: async () => {
    const { exists, readDir } = await fs()
    const opt = await at()
    if (!(await exists('projects', opt))) return []
    const all = await Promise.all((await readDir('projects', opt)).map((e) => readStored(e.name).then(summary, () => null)))
    return all.filter((s) => s !== null)
  },
  delete: async (id: string) => {
    const { remove } = await fs()
    await remove(dirOf(id), { ...(await at()), recursive: true })
  },
}

const store = isDesktop ? files : idb

export const saveProject = (p: Project) => store.save(p)
export const openProject = (id: string) => store.open(id)
export const deleteProject = (id: string) => store.delete(id)
export async function listProjects(): Promise<ProjectSummary[]> {
  return (await store.list()).sort((a, b) => b.updated - a.updated)
}

/** A small JPEG of a slide canvas, for the recent-projects list. */
export function thumbnail(canvas: HTMLCanvasElement | null) {
  if (!canvas) return undefined
  const c = document.createElement('canvas')
  c.height = 240
  c.width = Math.round((canvas.width / canvas.height) * 240)
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.75)
}

// ---- project files: one JSON file, screenshots inlined as data URLs ----------------

export const PROJECT_FILE = { name: 'Screenshot Studio project', extensions: ['ssproj'] }

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

export async function projectToFile(p: Project): Promise<Blob> {
  const { thumb: _thumb, ...rest } = await mapImages(p, (img) => {
    const b = blobOf(img)
    return b ? toDataUrl(b) : null
  })
  return new Blob([JSON.stringify({ format: 'screenshot-studio', version: 1, project: rest })], { type: 'application/json' })
}

/** Reads a project file into a project (same id, so opening a file again replaces its copy here). */
export async function projectFromFile(text: string): Promise<Project> {
  const data = JSON.parse(text)
  if (data?.format !== 'screenshot-studio') throw new Error('Not a Screenshot Studio project file')
  const p = await mapImages(data.project as WithImages<string | null>, async (u) =>
    u ? loadImage(await (await fetch(u)).blob()) : null)
  return { ...p, updated: Date.now() }
}
