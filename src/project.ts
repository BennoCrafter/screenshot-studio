// Projects: several platform targets (iPhone, iPad, Mac) under one name, kept in IndexedDB
// with their screenshots as Blobs.

import type { Platform, Slide, Target } from './render'

export interface Project {
  id: string
  name: string
  updated: number
  targets: Target[]
  thumb?: string // small JPEG data URL of the first slide, for the start page
}

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'updated' | 'thumb'> & { platforms: Platform[] }

// ---- images: keep each screenshot's Blob so it can be stored ----------------------

const blobs = new WeakMap<HTMLImageElement, Blob>()

export async function loadImage(blob: Blob) {
  const img = new Image()
  img.src = URL.createObjectURL(blob)
  await img.decode()
  blobs.set(img, blob)
  return img
}

// ---- IndexedDB --------------------------------------------------------------------

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

/** A project with its screenshots held as `I` (Blobs in IndexedDB, data URLs in a file). */
type WithImages<I> = Omit<Project, 'targets'> & {
  targets: (Omit<Target, 'slides'> & { slides: (Omit<Slide, 'image' | 'outerImage'> & { image: I; outerImage: I })[] })[]
}
type Stored = WithImages<Blob | null>

export function saveProject(p: Project) {
  const blob = (img: HTMLImageElement | null) => (img && blobs.get(img)) ?? null
  const stored: Stored = {
    ...p,
    targets: p.targets.map((t) => ({
      ...t,
      slides: t.slides.map((s) => ({ ...s, image: blob(s.image), outerImage: blob(s.outerImage) })),
    })),
  }
  return run('readwrite', (s) => s.put(stored))
}

export async function openProject(id: string): Promise<Project> {
  const p: Stored = await run('readonly', (s) => s.get(id))
  const img = (b: Blob | null) => (b ? loadImage(b) : null)
  return {
    ...p,
    targets: await Promise.all(p.targets.map(async (t) => ({
      ...t,
      slides: await Promise.all(t.slides.map(async (s) => ({ ...s, image: await img(s.image), outerImage: await img(s.outerImage) }))),
    }))),
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all: Stored[] = await run('readonly', (s) => s.getAll())
  return all
    .map(({ id, name, updated, thumb, targets }) => ({ id, name, updated, thumb, platforms: targets.map((t) => t.platform) }))
    .sort((a, b) => b.updated - a.updated)
}

export const deleteProject = (id: string) => run('readwrite', (s) => s.delete(id))

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
  const url = async (img: HTMLImageElement | null) => {
    const b = img && blobs.get(img)
    return b ? toDataUrl(b) : null
  }
  const targets = await Promise.all(p.targets.map(async (t) => ({
    ...t,
    slides: await Promise.all(t.slides.map(async (s) => ({ ...s, image: await url(s.image), outerImage: await url(s.outerImage) }))),
  })))
  const { thumb: _thumb, ...rest } = p
  return new Blob([JSON.stringify({ format: 'screenshot-studio', version: 1, project: { ...rest, targets } })], { type: 'application/json' })
}

/** Reads a project file into a project (same id, so opening a file again replaces its copy here). */
export async function projectFromFile(text: string): Promise<Project> {
  const data = JSON.parse(text)
  if (data?.format !== 'screenshot-studio') throw new Error('Not a Screenshot Studio project file')
  const p = data.project as WithImages<string | null>
  const img = async (u: string | null) => (u ? loadImage(await (await fetch(u)).blob()) : null)
  return {
    ...p,
    updated: Date.now(),
    targets: await Promise.all(p.targets.map(async (t) => ({
      ...t,
      slides: await Promise.all(t.slides.map(async (s) => ({ ...s, image: await img(s.image), outerImage: await img(s.outerImage) }))),
    }))),
  }
}
