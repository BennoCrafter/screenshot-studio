import { createContext, Fragment, useContext, useEffect, useRef, useState } from 'react'
import { Board } from './Board'
import { DEVICES, DEVICE_BY_ID, restFold } from './devices/models'
import type { DevicePose } from './devices/render3d'
import { Chat } from './Chat'
import { Themes } from './Themes'
import { openSettings } from './Settings'
import { animate } from './motion'
import { ask, FONT_FILES, IMAGE_FILES, isDesktop, openFiles, tell } from './native'
import { fontFamily, fontFrom, LANGUAGES, languageName, languagesOf, loadImage, type Project, type ProjectFont } from './project'
import { useStored } from './prefs'
import { added, isDevice, isText, itemOf, kindOf, labelOf, moved, positionOf, newItem, partName, removed, reset, resized, restack, rotated, shotIdOf, shotOf, withShot, withShotId, withText, type Shot } from './elements'
import { FONT, FONTS, layersOf, localize, PLATFORMS, sizeOf, type Item, type Part, type Platform, type Slide, type Style, type Target } from './render'
import { SlideCanvas } from './SlideCanvas'
import { SHAPES } from './shapes'
import { watchShotFolder } from './shotFolder'
import { Export } from './Export'
import { adaptTarget, ALL_PLATFORMS, poseFor, rotateTarget } from './templates'

type Updater<T> = (fn: (v: T) => T) => void
/** One element on one slide. */
type Sel = { slide: string; part: Part }
const same = (a: Sel, b: Sel) => a.slide === b.slide && a.part === b.part
const typing = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea, select, [contenteditable]')

// Copied elements, kept across projects; ponytail: in-app only, the system clipboard holds just typed text
let clipboard: { part: Part; slide: Slide }[] = []

export function Editor({ project, setProject: commit, onClose }: { project: Project; setProject: Updater<Project>; onClose: () => void }) {
  // undo history: a burst of changes (one drag, a few words typed) is one step
  const past = useRef<Project[]>([]), future = useRef<Project[]>([]), lastEdit = useRef(0)
  const setProject: Updater<Project> = (fn) => {
    if (Date.now() - lastEdit.current > 500) {
      past.current = [...past.current.slice(-99), project]
      future.current = []
    }
    lastEdit.current = Date.now()
    commit(fn)
  }
  const travel = (from: React.RefObject<Project[]>, to: React.RefObject<Project[]>) => {
    const p = from.current.pop()
    if (!p) return
    to.current.push(project)
    lastEdit.current = 0
    commit(() => p)
  }

  const [sideW, setSideW] = useWidth('side-w', 300)
  const [toolsW, setToolsW] = useWidth('tools-w', 220)
  const [dragged, setDragged] = useState<number | null>(null)
  const [ti, setTi] = useState(0)
  const target = project.targets[Math.min(ti, project.targets.length - 1)]
  const slides = target.slides
  const [selection, setSelection] = useState<Sel[]>([])
  const [editing, setEditing] = useState<Sel | null>(null) // text being typed on the slide
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const selectSlide = (id: string | null) => {
    setSelection(id ? [{ slide: id, part: 'device' }] : [])
    setEditing(null)
  }
  const size = sizeOf(target)
  const sel = slides.find((s) => s.id === selection.at(-1)?.slide) ?? null
  const shown = sel && (selection.filter((x) => x.slide === sel.id && layersOf(sel).includes(x.part)).at(-1)?.part ?? null) // in the inspector
  const shownKind = sel && shown && kindOf(sel, shown)
  /** The picked elements the inspector's settings fit: those of the shown one's kind. */
  const like = (s: Slide, p: Part) => kindOf(s, p) === shownKind
  const langs = languagesOf(project)
  const [picked, setLang] = useState(langs[0])
  const lang = langs.includes(picked) ? picked : langs[0]
  const [tab, setTab] = useState<'inspector' | 'chat'>('inspector')
  const langDialog = useRef<HTMLDialogElement>(null)

  const setTarget = (fn: (t: Target) => Target) =>
    setProject((p) => ({ ...p, targets: p.targets.map((t) => (t.platform === target.platform ? fn(t) : t)) }))
  const setSlides = (fn: (s: Slide[]) => Slide[]) => setTarget((t) => ({ ...t, slides: fn(t.slides) }))

  const showTarget = (i: number) =>
    animate(() => {
      setTi(i)
      selectSlide(null)
    })

  // languages share everything but the words
  const addLanguage = (code: string) => {
    setProject((p) => ({ ...p, languages: [...languagesOf(p), code] }))
    animate(() => setLang(code))
  }
  const removeLanguage = async (code: string) => {
    if (!(await ask(`Remove ${languageName(code)} and its text from this project?`))) return
    setProject((p) => ({
      ...p,
      languages: languagesOf(p).filter((l) => l !== code),
      targets: p.targets.map((t) => ({
        ...t,
        slides: t.slides.map(({ translations: { [code]: _gone, ...rest } = {}, ...s }) => ({ ...s, translations: rest })),
      })),
    }))
    animate(() => setLang(langs[0]))
  }
  const textLang = lang === langs[0] ? undefined : lang
  const setText = (s: Slide, part: Part, text: string) => update(s.id, withText(s, part, text, textLang))
  const addPlatform = (platform: Platform) => {
    setProject((p) => ({ ...p, targets: [...p.targets, adaptTarget(target, platform)] }))
    setTi(project.targets.length)
  }
  const removePlatform = async (platform: Platform) => {
    if (!(await ask(`Remove the ${PLATFORMS[platform].label} screenshots from this project?`))) return
    setProject((p) => ({ ...p, targets: p.targets.filter((t) => t.platform !== platform) }))
    setTi(0)
  }
  /** A font file added to the project (replacing one of the same name). */
  const addFont = async (file: File) => {
    const font = await fontFrom(file, file.name.replace(/\.[^.]+$/, ''))
    setProject((p) => ({ ...p, fonts: [...(p.fonts ?? []).filter((f) => f.name !== font.name), font] }))
    return font
  }
  /** Every text in the project, on every platform, set in `font`. */
  const fontForAll = (font: string) => setProject((p) => ({
    ...p,
    targets: p.targets.map((t) => ({ ...t, slides: t.slides.map((s) => ({ ...s, items: s.items?.map((i) => (i.kind === 'text' ? { ...i, font } : i)) })) })),
  }))
  const missing = ALL_PLATFORMS.filter((p) => !project.targets.some((t) => t.platform === p))

  const update = (id: string, patch: Partial<Slide>) =>
    setSlides((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  /** Picks an element (Shift adds or removes it); returns a mover for everything picked, or null if it was let go. */
  const press = (slide: Slide, part: Part, additive: boolean) => {
    const me = { slide: slide.id, part }
    if (!layersOf(slide).includes(part)) { // the background of a slide whose device was deleted: just pick the slide
      selectSlide(slide.id)
      return null
    }
    const has = selection.some((x) => same(x, me))
    // pressing a picked element keeps the group, so it can be dragged together
    const next = additive ? (has ? selection.filter((x) => !same(x, me)) : [...selection, me]) : has ? selection : [me]
    setSelection(next)
    setEditing(null)
    if (additive && has) return null
    const start = new Map(slides.map((s) => [s.id, s]))
    return (dx: number, dy: number) => setSlides((all) => all.map((s) => {
      const s0 = start.get(s.id)
      return s0 ? next.filter((x) => x.slide === s.id).reduce((s, x) => ({ ...s, ...moved(s0, s, x.part, dx, dy) }), s) : s
    }))
  }
  const grab = (s0: Slide, parts: Part[], about?: { x: number; y: number }) => (ratio: number) =>
    setSlides((all) => all.map((s) => (s.id !== s0.id ? s : parts.reduce((s, p) => {
      const r = { ...s, ...resized(s0, s, p, ratio) }
      if (!about) return r
      const at = positionOf(s0, p, [1, 1])
      return { ...r, ...moved(s0, r, p, (at.x - about.x) * (ratio - 1), (at.y - about.y) * (ratio - 1)) }
    }, s))))

  /** Applies `fn` to every picked element that's on its slide (and passes `only`). */
  const eachPicked = (fn: (s: Slide, part: Part) => Partial<Slide>, only = (_s: Slide, _p: Part) => true) =>
    setSlides((all) => all.map((s) => selection.filter((x) => x.slide === s.id && layersOf(s).includes(x.part) && only(s, x.part))
      .reduce((s, x) => ({ ...s, ...fn(s, x.part) }), s)))

  const remove = () => {
    eachPicked(removed)
    setSelection([])
    setEditing(null)
  }
  /** Every element on the picked slides, or on all slides when nothing is picked. */
  const selectAll = () => {
    const on = selection.length ? slides.filter((s) => selection.some((x) => x.slide === s.id)) : slides
    setSelection(on.flatMap((s) => layersOf(s).map((part) => ({ slide: s.id, part }))))
  }
  /** Adds an object (or puts back a deleted built-in) on each picked slide, or the first, which also get `patch`; a new text is ready to type. */
  const insert = (make: (s: Slide) => Item | Part, patch?: (s: Slide) => Partial<Slide>) => {
    const ids = new Set(selection.map((x) => x.slide))
    const made = new Map(slides.filter((s, i) => (ids.size ? ids.has(s.id) : i === 0)).map((s) => [s.id, make(s)]))
    setSlides((all) => all.map((s) => (made.has(s.id) ? { ...s, ...patch?.(s), ...added(s, made.get(s.id)!) } : s)))
    const picked = [...made].map(([slide, p]) => ({ slide, part: typeof p === 'string' ? p : p.id }))
    setSelection(picked)
    const first = [...made.values()][0]
    setEditing(typeof first !== 'string' && first.kind === 'text' ? picked[0] : null)
  }
  // a device mockup puts back the slide's own device if it was deleted, else adds another
  const insertDevice = (model: string) => {
    const picked = { model, finish: DEVICE_BY_ID[model].finishes[0].id, fold: restFold(DEVICE_BY_ID[model]) }
    insert((s) => layersOf(s).includes('device')
      ? newItem('device', undefined, poseFor(target.platform, { size: PLATFORMS[target.platform].device.size! * 0.7, ...picked }))
      : 'device', (s) => (layersOf(s).includes('device') ? {} : { device: { ...s.device, ...picked } })) // a put-back device becomes the picked model too
  }
  const [deviceMenu, setDeviceMenu] = useState<{ x: number; y: number } | null>(null)

  const copy = () => {
    const picked = selection.flatMap(({ slide, part }) => {
      const s = slides.find((s) => s.id === slide)
      return s && layersOf(s).includes(part) ? [{ part, slide: s }] : []
    })
    if (picked.length) clipboard = picked
  }
  // the slide's own device pasted onto a slide replaces its device and screenshots; anything else is pasted as a
  // new object, nudged when it lands on the slide it came from
  const paste = () => {
    const targets = new Set(selection.map((x) => x.slide))
    if (!clipboard.length || !targets.size) return
    const picked: Sel[] = []
    setSlides((all) => all.map((s) => !targets.has(s.id) ? s : clipboard.reduce((s, { part, slide }) => {
      const item = itemOf(slide, part)
      if (item) {
        const nudge = slide.id === s.id ? 0.03 : 0
        const copy = { ...item, id: crypto.randomUUID(), x: item.x + nudge, y: item.y + nudge }
        picked.push({ slide: s.id, part: copy.id })
        return { ...s, ...added(s, copy) }
      }
      picked.push({ slide: s.id, part })
      return { ...s, ...added(s, part), device: { ...slide.device }, image: slide.image, outerImage: slide.outerImage }
    }, s)))
    setSelection(picked)
  }
  /** The picked elements on slide `fromId` moved onto `toId`, which sits (dx, dy) slide sizes away, keeping where they
   *  are on screen. Text in every language goes along; the slide's own device replaces the one already there. */
  const transfer = (fromId: string, toId: string, dx: number, dy: number) => {
    const parts = selection.filter((x) => x.slide === fromId).map((x) => x.part)
    setSlides((all) => {
      let src = all.find((s) => s.id === fromId)!, to = all.find((s) => s.id === toId)!
      for (const part of parts) {
        if (!layersOf(src).includes(part)) continue
        to = { ...to, ...added(to, itemOf(src, part) ?? part) }
        if (part === 'device') to = { ...to, device: src.device, image: src.image, outerImage: src.outerImage }
        for (const [l, t] of Object.entries(src.translations ?? {})) {
          const text = t.items?.[part]
          if (text) to = { ...to, ...withText(to, part, text, l) }
          const shots = t.shots?.[part]
          if (shots) to = { ...to, ...withShot(to, part, { image: shots.image, outerImage: shots.outerImage }, l) }
        }
        to = { ...to, ...moved(to, to, part, -dx, -dy) }
        src = { ...src, ...removed(src, part) }
      }
      return all.map((s) => (s.id === fromId ? src : s.id === toId ? to : s))
    })
    setSelection(parts.map((part) => ({ slide: toId, part })))
  }
  const duplicate = () => {
    copy()
    paste()
  }

  // screenshots dropped into the project's screenshot folder replace the ones with their ID; a note says what changed
  const [notice, setNotice] = useState('')
  const live = useRef({ project, setProject })
  useEffect(() => { live.current = { project, setProject } })
  useEffect(() => {
    if (!isDesktop || !project.shotFolder) return
    let hide: ReturnType<typeof setTimeout>
    const off = watchShotFolder(() => live.current.project, (fn) => live.current.setProject(fn), (msg) => {
      setNotice(msg)
      clearTimeout(hide)
      hide = setTimeout(() => setNotice(''), 6000)
    })
    return () => { off(); clearTimeout(hide) }
  }, [project.shotFolder])

  // Esc clears the selection, so the board is in focus with nothing picked; ⌘Z/⇧⌘Z undo and redo, ⌘C/⌘V/⌘D copy, paste and
  // duplicate, ⌘A picks every element, Delete removes the picked ones
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // fields apply as they change, so Enter just leaves the field; one in a form submits it instead
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.target.form) return e.target.blur()
      if (typing(e.target) || document.querySelector('dialog[open]')) return
      const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase()
      if (e.key === 'Escape') { selectSlide(null); setMenu(null) }
      else if (mod && key === 'z') travel(e.shiftKey ? future : past, e.shiftKey ? past : future)
      else if (mod && key === 'y') travel(future, past)
      else if (mod && key === 'c') copy()
      else if (mod && key === 'v') paste()
      else if (mod && key === 'd') duplicate()
      else if (mod && key === 'a') selectAll()
      else if (e.key === 'Delete' || e.key === 'Backspace') remove()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const applyTheme = ({ bg1, bg2, angle, textColor }: Style) =>
    setSlides((all) => all.map((s) => ({ ...s, bg1, bg2, angle, textColor })))

  const addSlide = () => {
    const s = { ...(sel ?? slides[slides.length - 1]), id: crypto.randomUUID(), image: null, outerImage: null }
    setSlides((all) => [...all, s])
    selectSlide(s.id)
  }

  const duplicateSlide = (src: Slide) => {
    const copy = { ...src, id: crypto.randomUUID() }
    setSlides((all) => all.toSpliced(all.findIndex((s) => s.id === src.id) + 1, 0, copy))
    selectSlide(copy.id)
  }

  const removeSlide = (sel: Slide) => {
    if (slides.length === 1) return
    const rest = slides.filter((s) => s.id !== sel.id)
    setSlides(() => rest)
    selectSlide(rest[0].id)
  }

  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= slides.length) return
    setSlides((all) => all.toSpliced(from, 1).toSpliced(to, 0, all[from]))
  }

  // Dragging a slide on the board carries a thumbnail of it (the sidebar's row is its own), and the others make room as it passes over them.
  const dragStart = (e: React.DragEvent, i: number, thumb = false) => {
    e.dataTransfer.effectAllowed = 'move'
    const src = thumb && document.querySelector<HTMLCanvasElement>(`canvas[data-slide="${slides[i].id}"]`)
    if (src) {
      const k = document.createElement('canvas')
      k.width = 120
      k.height = (120 * src.height) / src.width
      k.getContext('2d')!.drawImage(src, 0, 0, k.width, k.height)
      k.style.cssText = 'position:fixed;left:-9999px;border-radius:8px'
      document.body.append(k)
      // held where the pointer is on the slide (the handle sits under it: the thumbnail's bottom edge), not by its middle
      const r = src.getBoundingClientRect()
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
      e.dataTransfer.setDragImage(k, clamp01((e.clientX - r.left) / r.width) * k.width, clamp01((e.clientY - r.top) / r.height) * k.height)
      setTimeout(() => k.remove())
    }
    setDragged(i)
  }
  const dragOver = (e: React.DragEvent, i: number) => {
    if (dragged === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragged !== i) {
      moveTo(dragged, i)
      setDragged(i)
    }
  }

  const move = (sel: Slide, dir: -1 | 1) => {
    const i = slides.indexOf(sel), j = i + dir
    if (j < 0 || j >= slides.length) return
    const next = [...slides]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSlides(() => next)
  }

  return (
    <div className="app" style={{ '--side-w': `${sideW}px`, '--tools-w': `${toolsW}px` } as React.CSSProperties}>
      <header className="topbar" data-tauri-drag-region>
        <button onClick={onClose} title="All projects"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>Projects</button>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
          aria-label="Project name"
        />
        <nav className="platform-tabs">
          {project.targets.map((t, i) => (
            <span key={t.platform} className={t === target ? 'on' : ''}>
              <button onClick={() => showTarget(i)}>{PLATFORMS[t.platform].label}</button>
              {project.targets.length > 1 && t === target && (
                <button className="tab-x" onClick={() => removePlatform(t.platform)} title="Remove this platform">×</button>
              )}
            </span>
          ))}
          {missing.length > 0 && (
            <button className="tab-add" title="Add a platform, starting from this one's slides" onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setAddMenu({ x: r.left, y: r.bottom + 6 })
            }}>+</button>
          )}
        </nav>
        <span className="divider" />
        <span className="platform-tabs">
          {langs.map((l, i) => (
            <span key={l} className={l === lang ? 'on' : ''}>
              <button onClick={() => animate(() => setLang(l))} title={i === 0 ? 'Primary language' : undefined}>{languageName(l)}</button>
              {l === lang && i > 0 && <button className="tab-x" onClick={() => removeLanguage(l)} title="Remove this language">×</button>}
            </span>
          ))}
          <button className="tab-add" onClick={() => langDialog.current!.showModal()} title="Add a language. Only the text differs between languages.">+</button>
        </span>
        <LanguageDialog dialog={langDialog} have={langs} onAdd={addLanguage} />
        <Themes size={size} current={localize(sel ?? slides[0], lang)} onApply={applyTheme} />
        <span className="spacer" />
        {!isDesktop && <button onClick={() => openSettings()} title="Settings (⌘,)" aria-label="Settings"><Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></button>}
        <button onClick={addSlide}>Add slide</button>
        <Export project={project} />
      </header>


      {/* outside the panel, which scrolls: inside it'd be clipped and scroll away */}
      <Resizer edge="right" set={(x) => setToolsW(Math.min(420, Math.max(180, x)))} />
      <aside className="tools">
        <h3>Elements</h3>
        <details className="add-section" open>
        <summary>Text</summary>
        <div className="add-grid">
          <button onClick={() => insert(() => newItem('text'))}><Icon d="M5 6V4h14v2M12 4v16M9 20h6" />Text</button>
          {TEXT_PRESETS.map(([label, preset]) => (
            <button key={label} onClick={() => insert(() => ({ ...newItem('text'), text: label, ...preset }))}>
              <span className="glyph" style={{ fontWeight: preset.weight, fontSize: 10 + preset.size * 100 }}>Aa</span>{label}
            </button>
          ))}
        </div>
        </details>
        <details className="add-section" open>
        <summary>Media</summary>
        <div className="add-grid">
          <button onClick={async () => {
            const [f] = await openFiles(IMAGE_FILES)
            if (f) { const img = await loadImage(f); insert(() => newItem('image', img)) }
          }}><Icon d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01" />Image</button>
          <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setDeviceMenu({ x: r.left, y: r.bottom + 4 }) }}><Icon d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2" />Device</button>
        </div>
        </details>
        {(['Shapes', 'Badges', 'Icons'] as const).map((group) => (
          <details key={group} className="add-section">
            <summary>{group}</summary>
            <div className="add-grid">
              {group === 'Shapes' && (
                <>
                  <button onClick={() => insert(() => newItem('rect'))}><Icon d="M4 6h16v12H4z" />Rectangle</button>
                  <button onClick={() => insert(() => newItem('ellipse'))}><Icon d="M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z" />Ellipse</button>
                </>
              )}
              {Object.entries(SHAPES).filter(([, s]) => s.group === group).map(([name, s]) => (
                <button key={name} onClick={() => insert(() => newItem('shape', undefined, undefined, name))}>
                  <svg viewBox={`0 0 ${s.vw} ${s.vh}`} width="20" height="20" aria-hidden
                    {...(s.stroke ? { fill: 'none', stroke: 'currentColor', strokeWidth: s.stroke, strokeLinecap: 'round', strokeLinejoin: 'round' } : { fill: 'currentColor' })}>
                    <path d={s.d} />
                  </svg>
                  {s.label}
                </button>
              ))}
            </div>
          </details>
        ))}

        <h3>Slides <span>{slides.length}</span></h3>
        <ol className="slide-list">
          {slides.map((s, i) => (
            <li
              key={s.id}
              className={`${s.id === sel?.id ? 'on' : ''} ${dragged === i ? 'dragging' : ''}`}
              draggable
              onDragStart={(e) => dragStart(e, i)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(e) => dragOver(e, i)}
              onDrop={(e) => e.preventDefault()}
            >
              <button onClick={() => selectSlide(s.id)} title="Drag to reorder"><b>{i + 1}</b><span>{labelOf(localize(s, lang)) || 'Untitled'}</span></button>
              <button title="Duplicate slide" onClick={() => duplicateSlide(s)}>⧉</button>
              <button title="Delete slide" disabled={slides.length === 1} onClick={() => removeSlide(s)}>×</button>
            </li>
          ))}
        </ol>
        <button className="restore" onClick={addSlide}>+ Add slide</button>

        {sel && (
          <>
            <h3>Layers</h3>
            <Layers
              sel={sel}
              picked={selection.filter((x) => x.slide === sel.id).map((x) => x.part)}
              pick={(part, additive) => press(sel, part, additive)}
              update={(patch) => update(sel.id, patch)}
            />
          </>
        )}
      </aside>

      <Board fitKey={`${target.platform}-${target.size}-${!!target.landscape}`} onEmptyClick={() => selectSlide(null)}>
        {slides.map((s, i) => (
          <div
            key={s.id}
            className={`slide-col ${dragged === i ? 'dragging' : ''}`}
            onDragOver={(e) => dragOver(e, i)}
            onDrop={(e) => e.preventDefault()}
          >
            <SlideCanvas
              slide={localize(s, lang)}
              size={size}
              selected={selection.filter((x) => x.slide === s.id).map((x) => x.part)}
              editing={editing?.slide === s.id ? editing.part : null}
              onPress={(part, additive) => press(s, part, additive)}
              onGrab={(parts, about) => grab(s, parts, about)}
              onMenu={(_, x, y) => setMenu({ x, y })}
              onEdit={(part) => setEditing(part ? { slide: s.id, part } : null)}
              onEditText={(part, text) => setText(s, part, text)}
              onRotate={(part, deg) => update(s.id, rotated(s, part, deg))}
              onTransfer={(to, dx, dy) => transfer(s.id, to, dx, dy)}
              onShot={(part, patch) => update(s.id, withShot(s, part, patch, textLang))}
            />
            {s.id === sel?.id && (
              <div className="slide-bar" onPointerDown={(e) => e.stopPropagation()}>
                <span className="handle" draggable title="Drag to move this slide" onDragStart={(e) => dragStart(e, i, true)} onDragEnd={() => setDragged(null)}>
                  ⠿ Slide {i + 1} of {slides.length}
                </span>
                <button title="Duplicate slide" onClick={() => duplicateSlide(s)}>Duplicate</button>
                <button title="Delete slide" className="danger" disabled={slides.length === 1} onClick={() => removeSlide(s)}>Delete</button>
              </div>
            )}
          </div>
        ))}
        <button className="add-slide" title="Add a slide" aria-label="Add a slide" onClick={addSlide}>
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </Board>
      {deviceMenu && (
        <div className="menu-backdrop" onPointerDown={() => setDeviceMenu(null)}>
          <div className="menu" ref={(el) => { if (el) el.style.top = `${Math.max(8, Math.min(deviceMenu.y, innerHeight - el.offsetHeight - 8))}px` }}
            style={{ left: deviceMenu.x, top: deviceMenu.y }} onPointerDown={(e) => e.stopPropagation()} onClick={() => setDeviceMenu(null)}>
            {[...new Set(DEVICES.map((d) => d.family))].map((f, n) => (
              <Fragment key={f}>
                {n > 0 && <hr />}
                <span className="menu-head">{f}</span>
                {DEVICES.filter((d) => d.family === f).map((d) => <button key={d.id} onClick={() => insertDevice(d.id)}>{d.label}</button>)}
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {addMenu && (
        <div className="menu-backdrop" onPointerDown={() => setAddMenu(null)}>
          <div className="menu" style={{ left: addMenu.x, top: addMenu.y }} onPointerDown={(e) => e.stopPropagation()} onClick={() => setAddMenu(null)}>
            {missing.map((p) => <button key={p} onClick={() => addPlatform(p)}>Add {PLATFORMS[p].label}</button>)}
          </div>
        </div>
      )}
      {menu && (
        <div className="menu-backdrop" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}>
          <div className="menu" ref={(el) => {
            if (!el) return
            const r = el.getBoundingClientRect()
            el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - r.width - 8))}px`
            el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - r.height - 8))}px`
          }} onPointerDown={(e) => e.stopPropagation()} onClick={() => setMenu(null)}>
            {selection.length === 1 && sel && isText(sel, selection[0].part) && (
              <button onClick={() => setEditing(selection[0])}>Edit text</button>
            )}
            <button onClick={copy}>Copy<kbd>⌘C</kbd></button>
            <button onClick={paste} disabled={!clipboard.length}>Paste<kbd>⌘V</kbd></button>
            <hr />
            <button onClick={() => eachPicked((s, p) => restack(s, p, () => Infinity))}>Bring to front</button>
            <button onClick={() => eachPicked((s, p) => restack(s, p, (n) => n + 1))}>Bring forward</button>
            <button onClick={() => eachPicked((s, p) => restack(s, p, (n) => n - 1))}>Send backward</button>
            <button onClick={() => eachPicked((s, p) => restack(s, p, () => 0))}>Send to back</button>
            <hr />
            <button onClick={duplicate}>Duplicate<kbd>⌘D</kbd></button>
            <button onClick={() => eachPicked(reset)}>Reset position</button>
            <button onClick={remove}>Delete<kbd>⌫</kbd></button>
            <button onClick={() => travel(past, future)} disabled={!past.current.length}>Undo<kbd>⌘Z</kbd></button>
            {sel && <>
              <hr />
              <button onClick={() => move(sel, -1)} disabled={slides.indexOf(sel) === 0}>Move slide left</button>
              <button onClick={() => move(sel, 1)} disabled={slides.indexOf(sel) === slides.length - 1}>Move slide right</button>
              <button onClick={() => removeSlide(sel)} disabled={slides.length === 1}>Delete slide</button>
            </>}
          </div>
        </div>
      )}

      <aside className="side">
        <Resizer edge="left" set={(x) => setSideW(Math.min(700, Math.max(260, window.innerWidth - x)))} />
        {isDesktop && (
          <nav className="platform-tabs side-tabs">
            <span className={tab === 'inspector' ? 'on' : ''}><button onClick={() => setTab('inspector')}>Inspector</button></span>
            <span className={tab === 'chat' ? 'on' : ''}><button onClick={() => setTab('chat')}>Agent</button></span>
          </nav>
        )}
        <div className="inspector" hidden={tab !== 'inspector'}>
          {sel ? (
            <SlideInspector
              key={sel.id}
              sel={sel}
              part={shown}
              edit={(fn) => eachPicked(fn, like)}
              likes={selection.flatMap((x) => { const s = slides.find((s) => s.id === x.slide); return s && layersOf(s).includes(x.part) && like(s, x.part) ? [{ s, p: x.part }] : [] })}
              lang={textLang}
              setText={(part, text) => setText(sel, part, text)}
              fonts={project.fonts ?? []}
              addFont={addFont}
              fontForAll={fontForAll}
              index={slides.indexOf(sel)}
              size={size}
              update={(patch) => update(sel.id, patch)}
              pickedSlides={slides.filter((s) => selection.some((x) => x.slide === s.id))}
              updateSlides={(patch) => setSlides((all) => all.map((s) => (selection.some((x) => x.slide === s.id) ? { ...s, ...patch } : s)))}
              shotIdUser={(id, part) => {
                for (const t of project.targets) for (const [i, s] of t.slides.entries()) for (const p of layersOf(s))
                  if (shotIdOf(s, p) === id && !(s.id === sel.id && p === part)) return `${PLATFORMS[t.platform].label} slide ${i + 1} (${partName(s, p)})`
                return null
              }}
            />
          ) : (
            <>
              <h2>{PLATFORMS[target.platform].label}</h2>
              <p className="hint">Click a slide to edit it. Click empty board space or press Esc to clear the selection.</p>
              {target.platform !== 'mac' && (
                <div className="orient">
                  All slides · {size[0]}×{size[1]}
                  <span className="platform-tabs">
                    {([false, true] as const).map((l) => (
                      <span key={String(l)} className={!!target.landscape === l ? 'on' : ''}>
                        <button onClick={() => !!target.landscape !== l && setTarget(rotateTarget)}>{l ? 'Landscape' : 'Portrait'}</button>
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {isDesktop && <Chat hidden={tab !== 'chat'} />}
      </aside>
      {notice && <div className="toast" role="status" onClick={() => setNotice('')}>{notice}</div>}
    </div>
  )
}

/** The picked element's settings (the last one, when several are picked), then the slide's own. */
function SlideInspector({ sel, part, lang, setText, fonts, addFont, fontForAll, index, size, update, edit, likes, pickedSlides, updateSlides, shotIdUser }: {
  sel: Slide
  fonts: ProjectFont[] // the project's own
  addFont: (file: File) => Promise<ProjectFont>
  fontForAll: (font: string) => void
  part: Part | null // the picked element on this slide
  lang?: string // the language being edited, when not the primary one: text and screenshots set here are its own
  setText: (part: Part, text: string) => void
  index: number
  size: readonly [number, number] // the slide in px
  update: (patch: Partial<Slide>) => void
  /** Applies `fn` to every picked element of the shown one's kind, on any picked slide. */
  edit: (fn: (s: Slide, part: Part) => Partial<Slide>) => void
  likes: Picked[] // those elements
  pickedSlides: Slide[] // slides with something picked
  /** Sets the slide's own settings (background, …) on every picked slide. */
  updateSlides: (patch: Partial<Slide>) => void
  /** Where else in the project a screenshot ID is used, if anywhere: IDs are unique. */
  shotIdUser: (id: string, part: Part) => string | null
}) {
  const item = part ? itemOf(sel, part) : undefined
  const at = part ? positionOf(sel, part, size) : null
  const likeCount = likes.length, slideCount = pickedSlides.length
  const slidesDiffer = (get: (s: Slide) => unknown) => differ(pickedSlides.map(get))
  const posDiffers = (axis: 'x' | 'y') => differ(likes.map(({ s, p }) => Math.round(positionOf(s, p, size)[axis])))
  const [showIds] = useStored<'on' | 'off'>('shot-ids', 'off')
  const setItem = (patch: Partial<Item> | ((i: Item) => Partial<Item>)) =>
    edit((s, p) => ({ items: s.items!.map((i) => (i.id === p ? { ...i, ...(typeof patch === 'function' ? patch(i) : patch) } : i)) }))
  // under the element's screenshot picker
  const idField = part && showIds === 'on' && (
    <ShotIdField key={part} id={shotIdOf(sel, part) ?? ''} user={(id) => shotIdUser(id, part)} set={(id) => update(withShotId(sel, part, id))} />
  )
  return (
    <Picks.Provider value={likes}>
    <div className="inspector-body">
      {part && <h2>{likeCount > 1 ? `${likeCount} ${kindName(sel, part)}` : partName(sel, part)}</h2>}
      {part && likeCount > 1 && <p className="hint">Changes here apply to all {likeCount} picked {kindName(sel, part)}, on every picked slide. Text and screenshot IDs stay their own.</p>}
      {part && at && (
        <div className="vec2">
          <span>Position{(posDiffers('x') || posDiffers('y')) && <Mixed />}</span>
          {(['x', 'y'] as const).map((axis) => (
            <ScrubNumber key={axis} axis={axis} value={Math.round(at[axis])} onChange={(v) =>
              edit((s, p) => { const a = positionOf(s, p, size); return moved(s, s, p, axis === 'x' ? (v - a.x) / size[0] : 0, axis === 'y' ? (v - a.y) / size[1] : 0) })} />
          ))}
        </div>
      )}
      {part && isDevice(sel, part) && <DeviceInspector sel={sel} device={part} lang={lang} edit={edit} idField={idField} />}
      {item?.kind === 'text' && <TextInspector item={item} sel={sel} lang={lang} fonts={fonts} addFont={addFont} fontForAll={fontForAll} set={setItem} setText={(t) => setText(item.id, t)} />}
      {(item?.kind === 'rect' || item?.kind === 'ellipse' || item?.kind === 'shape') && (
        <label>Color{differ(likes.map(({ s, p }) => itemOf(s, p)?.color ?? s.textColor)) && <Mixed />}<input type="color" value={item.color ?? sel.textColor} onChange={(e) => setItem({ color: e.target.value })} /></label>
      )}
      {item?.kind === 'image' && (
        <>
          <ShotPicker label="Image" image={item.image ?? null} set={(image) => setItem((i) => ({ image, h: (i.w * image.naturalHeight) / image.naturalWidth }))} />
          {idField}
        </>
      )}

      <h2 className={part ? 'inspector-slide' : undefined}>{slideCount > 1 ? `${slideCount} slides` : `Slide ${index + 1}`}</h2>
      {slideCount > 1 && <p className="hint">Background, text color and gradient angle change on all {slideCount} picked slides.</p>}
      <div className="row">
        <label>Background{(slidesDiffer((s) => s.bg1) || slidesDiffer((s) => s.bg2)) && <Mixed />}<input type="color" value={sel.bg1} onChange={(e) => updateSlides({ bg1: e.target.value })} /></label>
        <label>&nbsp;<input type="color" value={sel.bg2} onChange={(e) => updateSlides({ bg2: e.target.value })} /></label>
        <label>Text{slidesDiffer((s) => s.textColor) && <Mixed />}<input type="color" value={sel.textColor} onChange={(e) => updateSlides({ textColor: e.target.value })} /></label>
      </div>
      <div className="field">
        <div className="field-head">
          Gradient angle · {slidesDiffer((s) => s.angle) ? 'Mixed' : `${sel.angle}°`}
          {sel.angle !== 0 && <button type="button" className="link" onClick={() => updateSlides({ angle: 0 })}>Reset</button>}
        </div>
        <input type="range" aria-label="Gradient angle" min={0} max={360} value={sel.angle} onDoubleClick={() => updateSlides({ angle: 0 })} onChange={(e) => updateSlides({ angle: +e.target.value })} />
      </div>
    </div>
    </Picks.Provider>
  )
}

type Picked = { s: Slide; p: Part }
/** The picked elements the inspector edits together, so their settings can say when they differ. */
const Picks = createContext<Picked[]>([])
const differ = (values: unknown[]) => new Set(values).size > 1
/** Whether the picked elements disagree on a setting. */
function useDiffers() {
  const picks = useContext(Picks)
  return (get: (s: Slide, p: Part) => unknown) => differ(picks.map(({ s, p }) => get(s, p)))
}
/** Marks a setting the picked elements or slides disagree on: it shows the last one's value. */
const Mixed = () => <small className="mixed"> · Mixed</small>

/** 'texts', 'devices', … for a heading over several picked elements. */
const kindName = (s: Slide, p: Part) => ({ text: 'texts', rect: 'rectangles', ellipse: 'ellipses', shape: 'shapes', image: 'images', device: 'devices' })[kindOf(s, p) ?? 'text']

/** A number with its axis letter in front, like Godot, Blender or Unity: type it, or drag the letter sideways to scrub (Shift for fine steps). */
function ScrubNumber({ axis, value, onChange }: { axis: 'x' | 'y'; value: number; onChange: (v: number) => void }) {
  const start = useRef<{ x: number; v: number } | null>(null)
  return (
    <label className={`scrub ${axis}`}>
      <b
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, v: value } }}
        onPointerMove={(e) => start.current && onChange(Math.round(start.current.v + (e.clientX - start.current.x) * (e.shiftKey ? 0.2 : 2)))}
        onPointerUp={() => (start.current = null)}
        onPointerCancel={() => (start.current = null)}
      >{axis.toUpperCase()}</b>
      <input type="number" value={value} onChange={(e) => e.target.value !== '' && onChange(+e.target.value)} />
    </label>
  )
}

/** Texts with their size and weight set, as the templates use them. */
const TEXT_PRESETS = [
  ['Headline', { size: 0.085, weight: 800 }],
  ['Subtitle', { size: 0.042, weight: 500 }],
  ['Caption', { size: 0.03, weight: 500, opacity: 0.8 }],
] as const satisfies readonly (readonly [string, Partial<Item> & { size: number; weight: number }])[]

const WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Heavy'], [900, 'Black']] as const

function TextInspector({ item, sel, lang, fonts, addFont, fontForAll, set, setText }: {
  item: Item
  sel: Slide
  lang?: string
  fonts: ProjectFont[]
  addFont: (file: File) => Promise<ProjectFont>
  fontForAll: (font: string) => void
  set: (patch: Partial<Item>) => void
  setText: (text: string) => void
}) {
  const weight = item.weight ?? 600, font = item.font ?? FONT
  const known = [...fonts.map((f) => fontFamily(f.name)), ...Object.values(FONTS)]
  const differs = useDiffers(), one = useContext(Picks).length <= 1
  const its = (get: (i: Item) => unknown) => differs((s, p) => { const i = itemOf(s, p); return i && get(i) })
  return (
    <>
      {one && (
        <label>
          Text
          {/* another language shows the primary language's words until it has its own */}
          <textarea rows={3} value={lang ? sel.translations?.[lang]?.items?.[item.id] ?? '' : item.text ?? ''} placeholder={lang ? item.text : undefined}
            onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      <div className="field">
        <div className="field-head">
          <span>Font{its((i) => i.font ?? FONT) && <Mixed />}</span>
          <span>
            <button type="button" className="link" title="Use this font for every text in the project" onClick={() => fontForAll(font)}>Apply to all</button>
            {' · '}
            <button type="button" className="link" onClick={async () => {
              const [f] = await openFiles(FONT_FILES)
              if (!f) return
              try {
                set({ font: fontFamily((await addFont(f)).name) })
              } catch (err) {
                tell((err as Error).message)
              }
            }}>Add font…</button>
          </span>
        </div>
        <select aria-label="Font" value={font} style={{ fontFamily: font }} onChange={(e) => set({ font: e.target.value })}>
          {!known.includes(font) && <option value={font}>{font.split(',')[0].replace(/"/g, '')}</option>}
          {fonts.length > 0 && (
            <optgroup label="This project">
              {fonts.map((f) => <option key={f.name} value={fontFamily(f.name)} style={{ fontFamily: fontFamily(f.name) }}>{f.name}</option>)}
            </optgroup>
          )}
          <optgroup label="Built in">
            {Object.entries(FONTS).map(([name, f]) => <option key={name} value={f} style={{ fontFamily: f }}>{name}</option>)}
          </optgroup>
        </select>
      </div>
      <div className="row">
        <label>
          <span>Size{its((i) => i.size ?? 0.05) && <Mixed />}</span>
          <input type="number" min={1} max={50} step={0.1} value={Math.round((item.size ?? 0.05) * 1000) / 10}
            onChange={(e) => +e.target.value > 0 && set({ size: +e.target.value / 100 })} />
        </label>
        <label>
          <span>Weight{its((i) => i.weight ?? 600) && <Mixed />}</span>
          <select value={weight} onChange={(e) => set({ weight: +e.target.value })}>
            {!WEIGHTS.some(([w]) => w === weight) && <option value={weight}>{weight}</option>}
            {WEIGHTS.map(([w, n]) => <option key={w} value={w}>{n}</option>)}
          </select>
        </label>
      </div>
      <input type="range" aria-label="Size" min={0.01} max={0.2} step={0.001} value={item.size ?? 0.05} onChange={(e) => set({ size: +e.target.value })} />
      <div className="row">
        <label>Color{differs((s, p) => itemOf(s, p)?.color ?? s.textColor) && <Mixed />}<input type="color" value={item.color ?? sel.textColor} onChange={(e) => set({ color: e.target.value })} /></label>
        <label>
          Opacity · {its((i) => i.opacity ?? 1) ? 'Mixed' : `${Math.round((item.opacity ?? 1) * 100)}%`}
          <input type="range" min={0.1} max={1} step={0.01} value={item.opacity ?? 1} onChange={(e) => set({ opacity: +e.target.value })} />
        </label>
      </div>
      <p className="hint">Double-click the text on the slide to type there. Size is a percentage of the slide's width.</p>
    </>
  )
}

/** A device's screenshots and pose: the slide's own (`device` = 'device') or an added one. */
function DeviceInspector({ sel, device, lang, edit, idField }: { sel: Slide; device: Part; lang?: string; edit: (fn: (s: Slide, part: Part) => Partial<Slide>) => void; idField?: React.ReactNode }) {
  const shot = shotOf(sel, device), pose = shot.device
  const setShot = (patch: Partial<Shot>) => edit((s, p) => withShot(s, p, patch, lang))
  const own = lang ? sel.translations?.[lang]?.shots?.[device] : undefined // this language's own screenshots
  const shotLabel = (what: string, has?: HTMLImageElement | null) => (
    <>{what}{lang && <small className="shot-lang">{has ? ` · ${languageName(lang)} only` : ' · same as primary'}{has && (
      <button type="button" className="link" onClick={() => setShot({ [what === 'Screenshot' ? 'image' : 'outerImage']: null })}>Use primary</button>
    )}</small>}</>
  )
  // each device keeps the rest of its own pose
  const setDevice = (patch: Partial<DevicePose>) => edit((s, p) => withShot(s, p, { device: { ...shotOf(s, p).device, ...patch } }, lang))
  const model = DEVICE_BY_ID[pose.model]
  const differs = useDiffers()
  const poses = (get: (d: DevicePose) => unknown) => differs((s, p) => get(shotOf(s, p).device))
  const families = [...new Set(DEVICES.map((d) => d.family))]
  return (
    <>
      <ShotPicker label={shotLabel('Screenshot', own?.image)} image={own?.image ?? shot.image} set={(image) => setShot({ image })} />
      {model.outer && (
        <ShotPicker label={shotLabel('Outer screenshot (shown when closed)', own?.outerImage)} image={own?.outerImage ?? shot.outerImage} set={(outerImage) => setShot({ outerImage })} />
      )}
      {idField}
      <label>
        <span>Device{poses((d) => d.model) && <Mixed />}</span>
        <select value={model.id} onChange={(e) => setDevice({ model: e.target.value, finish: DEVICE_BY_ID[e.target.value].finishes[0].id })}>
          {families.map((f) => (
            <optgroup key={f} label={f}>
              {DEVICES.filter((d) => d.family === f).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        <span>Finish{poses((d) => d.finish) && <Mixed />}</span>
        <select value={pose.finish} onChange={(e) => setDevice({ finish: e.target.value })}>
          {model.finishes.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <p className="hint">Drag the device to move it, the round grip in its middle to turn it, the second grip on a foldable or Mac to fold it, the corners to resize and the top handle to spin. Shift snaps to 15°.</p>
      <label>
        Device size · {poses((d) => d.size) ? 'Mixed' : `${Math.round(pose.size * 100)}%`}
        <input type="range" min={0.3} max={1.2} step={0.01} value={pose.size} onChange={(e) => setDevice({ size: +e.target.value })} />
      </label>
      <AngleSlider label="Turn" max={180} value={pose.yaw} mixed={poses((d) => d.yaw)} set={(yaw) => setDevice({ yaw })} />
      <AngleSlider label="Spin" max={180} value={pose.roll ?? 0} mixed={poses((d) => d.roll ?? 0)} set={(roll) => setDevice({ roll })} />
      <AngleSlider label="Tilt" max={90} value={pose.pitch} mixed={poses((d) => d.pitch)} set={(pitch) => setDevice({ pitch })} />
      {(model.fold || model.laptop) && (
        <label>
          {model.laptop ? 'Lid' : 'Fold'} · {poses((d) => d.fold) ? 'Mixed' : `${pose.fold}°`}
          <input type="range" min={0} max={180} value={pose.fold} onChange={(e) => setDevice({ fold: +e.target.value })} />
        </label>
      )}
      <label><input type="checkbox" checked={pose.shadow !== false} onChange={(e) => setDevice({ shadow: e.target.checked })} />Shadow{poses((d) => d.shadow !== false) && <Mixed />}</label>
      <label><input type="checkbox" checked={pose.reflections !== false} onChange={(e) => setDevice({ reflections: e.target.checked })} />Reflections{poses((d) => d.reflections !== false) && <Mixed />}</label>
    </>
  )
}

/** A −max…max° slider that snaps to 0 near it; Reset or a double-click sets it back to 0. */
function AngleSlider({ label, max, value, mixed, set }: { label: string; max: number; value: number; mixed?: boolean; set: (v: number) => void }) {
  const keys = useRef(false) // arrow keys step 1° and must not snap back, or they could never leave 0
  return (
    <div className="field">
      <div className="field-head">
        {label} · {mixed ? 'Mixed' : `${value}°`}
        {(mixed || value !== 0) && <button type="button" className="link" onClick={() => set(0)}>Reset</button>}
      </div>
      <input type="range" aria-label={label} min={-max} max={max} value={value} onDoubleClick={() => set(0)}
        onKeyDown={() => (keys.current = true)} onPointerDown={() => (keys.current = false)}
        onChange={(e) => set(!keys.current && Math.abs(+e.target.value) <= 4 ? 0 : +e.target.value)} />
    </div>
  )
}

/** An element's screenshot ID:a file of that name in the screenshot folder replaces its screenshot. One taken
 * elsewhere in the project isn't kept, so each ID stays on one element. */
function ShotIdField({ id, user, set }: { id: string; user: (id: string) => string | null; set: (id: string) => void }) {
  const [draft, setDraft] = useState(id)
  const taken = draft ? user(draft) : null
  return (
    <label title="A file named after this ID in the project's screenshot folder (Settings › Project) replaces this screenshot">
      Screenshot ID
      <input value={draft} placeholder="e.g. home-screen" spellCheck={false} aria-invalid={!!taken} onChange={(e) => {
        const v = e.target.value.replace(/\s/g, '-')
        setDraft(v)
        if (!v || !user(v)) set(v)
      }} />
      {taken && <small className="taken">Already used by {taken}</small>}
    </label>
  )
}

/** A screenshot slot: shows the one set (it survives reloads, unlike a file input's name) and opens a picker for another. */
function ShotPicker({ label, image, set }: { label: React.ReactNode; image: HTMLImageElement | null; set: (img: HTMLImageElement) => void }) {
  return (
    <label>
      {label}
      <button type="button" className="shot-picker" onClick={async () => {
        const [f] = await openFiles(IMAGE_FILES)
        if (f) set(await loadImage(f))
      }}>
        {image ? <><img src={image.src} alt="" />Replace…</> : 'Choose image…'}
      </button>
    </label>
  )
}

/** The slide's elements, frontmost first: click to pick (Shift adds), arrows move one up or down the stack. */
/** A panel width, remembered between launches. */
function useWidth(key: string, initial: number) {
  const [w, setW] = useState(() => { try { return Number(localStorage.getItem(key)) || initial } catch { return initial } })
  useEffect(() => { try { localStorage.setItem(key, String(w)) } catch { /* not remembered */ } }, [key, w])
  return [w, setW] as const
}

/** A drag handle on a panel's edge; `set` gets the pointer's x. */
function Resizer({ edge, set }: { edge: 'left' | 'right'; set: (x: number) => void }) {
  return (
    <div
      className={`resizer ${edge}`}
      title="Drag to resize"
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(e.clientX)}
    />
  )
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
)

function Layers({ sel, picked, pick, update }: {
  sel: Slide
  picked: Part[]
  pick: (part: Part, additive: boolean) => void
  update: (patch: Partial<Slide>) => void
}) {
  const order = layersOf(sel).toReversed()
  return (
    <ul className="layers">
      {order.map((p, i) => (
        <li key={p} className={picked.includes(p) ? 'on' : ''}>
          <button onClick={(e) => pick(p, e.shiftKey)}>{partName(sel, p)}</button>
          <button title="Bring forward" disabled={i === 0} onClick={() => update(restack(sel, p, (n) => n + 1))}>↑</button>
          <button title="Send backward" disabled={i === order.length - 1} onClick={() => update(restack(sel, p, (n) => n - 1))}>↓</button>
        </li>
      ))}
      <li><button disabled>Background</button></li>
    </ul>
  )
}

const localNames = new Intl.DisplayNames(undefined, { type: 'language' })
const englishNames = new Intl.DisplayNames(['en'], { type: 'language' })

/** A language tag in canonical form ("de-at" → "de-AT"), or the text as typed for a custom language. */
function toCode(text: string) {
  try {
    return Intl.getCanonicalLocales(text.trim())[0]
  } catch {
    return text.trim()
  }
}

/** Search the App Store languages by any of their names, or add one of your own. */
function LanguageDialog({ dialog, have, onAdd }: {
  dialog: React.RefObject<HTMLDialogElement | null>
  have: string[]
  onAdd: (code: string) => void
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const names = (l: string) => [l, languageName(l), localNames.of(l), englishNames.of(l)].map((n) => n?.toLowerCase() ?? '')
  const matches = LANGUAGES.filter((l) => !have.includes(l) && names(l).some((n) => n.includes(query)))
  const exact = LANGUAGES.some((l) => names(l).includes(query))
  const custom = query && !exact && !have.includes(toCode(q)) ? toCode(q) : null
  const pick = (code: string) => {
    onAdd(code)
    setQ('')
    dialog.current!.close()
  }
  return (
    <dialog ref={dialog} className="lang-dialog" onClick={(e) => e.target === dialog.current && dialog.current!.close()} onClose={() => setQ('')}>
      <form onSubmit={(e) => {
        e.preventDefault()
        const first = matches[0] ?? custom
        if (first) pick(first)
      }}>
        <h2>Add a language</h2>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type a language, e.g. German or de-AT" />
        <ul>
          {matches.map((l) => (
            <li key={l}>
              <button type="button" onClick={() => pick(l)}>
                {languageName(l)}
                <small>{localNames.of(l) !== languageName(l) ? `${localNames.of(l)} · ` : ''}{l}</small>
              </button>
            </li>
          ))}
          {custom && (
            <li>
              <button type="button" onClick={() => pick(custom)}>
                Add “{languageName(custom)}”
                <small>custom</small>
              </button>
            </li>
          )}
        </ul>
      </form>
    </dialog>
  )
}
