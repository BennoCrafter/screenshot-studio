import { Fragment, useEffect, useRef, useState } from 'react'
import { Board } from './Board'
import { DEVICES, DEVICE_BY_ID, restFold } from '../devices/models'
import { Chat } from '../agent/Chat'
import { Themes } from './Themes'
import { animate } from '../lib/motion'
import { ask, isDesktop, typing } from '../lib/native'
import { fontFrom, languageName, languagesOf, type Project } from '../model/project'
import { openSettings, useStored, useWidth } from '../settings/prefs'
import { Cheatsheet } from '../settings/Settings'
import { added, deviceAsItem, isDevice, isText, itemOf, kindOf, labelOf, moved, positionOf, newItem, partName, removed, reset, resized, restack, rotated, shotIdOf, shotIdsOf, transferred, withShot, withText } from '../model/elements'
import { clamp, layersOf, localize, PLATFORMS, sizeOf, type Item, type Part, type Platform, type Slide, type Style, type Target } from '../model/render'
import { SlideCanvas } from './SlideCanvas'
import { watchShotFolder } from '../model/shotFolder'
import { Export } from '../export/Export'
import { adaptTarget, ALL_PLATFORMS, poseFor, rotateTarget } from '../model/templates'
import { useHistory, type Updater } from './history'
import { SlideInspector } from './Inspector'
import { LanguageDialog } from './LanguageDialog'
import { Layers, Palette } from './Palette'
import { Icon, Menu, Resizer } from './ui'

/** One element on one slide. */
type Sel = { slide: string; part: Part }
const same = (a: Sel, b: Sel) => a.slide === b.slide && a.part === b.part

// Copied elements, kept across projects; shortcut: in-app only, the system clipboard holds just typed text
let clipboard: { part: Part; slide: Slide }[] = []
const keep = (copied: typeof clipboard) => { clipboard = copied }

export function Editor({ project, setProject: commit, onClose }: { project: Project; setProject: Updater<Project>; onClose: () => void }) {
  const { setProject, undo, redo, canUndo } = useHistory(project, commit)

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
    if (picked.length) keep(picked)
  }
  // the slide's own device pasted onto another slide replaces its device and screenshots; anything else (the own device
  // on its own slide too) is pasted as a new object, nudged when it lands on the slide it came from
  const paste = () => {
    const targets = new Set(selection.map((x) => x.slide))
    if (!clipboard.length || !targets.size) return
    const picked: Sel[] = []
    setSlides((all) => all.map((s) => !targets.has(s.id) ? s : clipboard.reduce((s, { part, slide }) => {
      const item = itemOf(slide, part) ?? (slide.id === s.id ? deviceAsItem(slide) : undefined)
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
  /** The picked elements on slide `fromId` moved onto `toId`, which sits (dx, dy) slide sizes away. */
  const transfer = (fromId: string, toId: string, dx: number, dy: number) => {
    const parts = selection.filter((x) => x.slide === fromId).map((x) => x.part)
    setSlides((all) => {
      const [src, to] = transferred(all.find((s) => s.id === fromId)!, all.find((s) => s.id === toId)!, parts, dx, dy)
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
  const fetchShot = useRef<(id: string) => void>(undefined)
  const [found, setFound] = useState<{ folder: string; ids: Set<string> }>() // screenshot IDs with a file in the folder
  const folderIds = found && found.folder === project.shotFolder ? found.ids : new Set<string>()
  useEffect(() => { live.current = { project, setProject } })
  useEffect(() => {
    const folder = project.shotFolder
    if (!isDesktop || !folder) return
    let hide: ReturnType<typeof setTimeout>
    const watch = watchShotFolder(() => live.current.project, (fn) => live.current.setProject(fn), (msg) => {
      setNotice(msg)
      clearTimeout(hide)
      hide = setTimeout(() => setNotice(''), 6000)
    }, (ids) => setFound({ folder, ids }))
    fetchShot.current = watch.fetch
    return () => { watch.stop(); fetchShot.current = undefined; clearTimeout(hide) }
  }, [project.shotFolder])
  // badges on the device frames: green when their screenshot ID has a file in the screenshot folder, amber when only the
  // primary language's does (this language has no ID of its own, so it shows that screenshot)
  const [badges, setBadges] = useStored<'on' | 'off'>('shot-badges', 'off')
  const badgesOf = (s: Slide) => badges === 'on' ? Object.fromEntries(layersOf(s).filter((p) => isDevice(s, p)).map((p) => {
    const own = shotIdOf(s, p, textLang), id = own ?? shotIdOf(s, p)
    const ok = !!id && folderIds.has(id), borrowed = ok && textLang && !own
    return [p, { state: borrowed ? 'borrowed' : ok ? 'ok' : 'missing', text: borrowed ? `${languageName(langs[0])} only` : id ? "" : 'No ID',
      title: !id ? 'No screenshot ID' : !project.shotFolder ? 'No screenshot folder (Settings › Project)'
        : borrowed ? `${languageName(lang)} has no screenshot ID of its own, so it shows the ${languageName(langs[0])} screenshot (${id})`
        : ok ? `${id} is in the screenshot folder` : `No file named ${id} in the screenshot folder` } as const]
  })) : undefined
  const [reveal, setReveal] = useState<{ slide: string; fill?: boolean }>() // a slide picked by keyboard, brought on screen

  // Esc clears the selection, so the board is in focus with nothing picked; ⌘Z/⇧⌘Z undo and redo, ⌘C/⌘V/⌘D copy, paste and
  // duplicate, ⌘A picks every element, Delete removes the picked ones; I toggles the screenshot badges, L / D step through
  // the languages / platforms (Shift goes back), ← / → or 1…9 (⌘ optional) pick a slide, ↑ zooms the picked one to fill the board
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // fields apply as they change, so Enter just leaves the field; one in a form submits it instead
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.target.form) return e.target.blur()
      if (typing(e.target) || document.querySelector('dialog[open]')) return
      const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase(), step = e.shiftKey ? -1 : 1
      if (e.key === 'Escape') { selectSlide(null); setMenu(null) }
      else if (mod && key === 'z') (e.shiftKey ? redo : undo)()
      else if (mod && key === 'y') redo()
      else if (mod && key === 'c') copy()
      else if (mod && key === 'v') paste()
      else if (mod && key === 'd') duplicate()
      else if (mod && key === 'a') selectAll()
      else if (/^[1-9]$/.test(e.key) && !e.altKey) {
        const s = slides[+e.key - 1]
        if (s) { selectSlide(s.id); setReveal({ slide: s.id }) }
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') remove()
      else if (mod || e.altKey) return
      else if (key === 'i') setBadges(badges === 'on' ? 'off' : 'on')
      else if (key === 'l') animate(() => setLang(langs[(langs.indexOf(lang) + step + langs.length) % langs.length]))
      else if (key === 'd') showTarget((project.targets.indexOf(target) + step + project.targets.length) % project.targets.length)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = sel ? slides.indexOf(sel) + (e.key === 'ArrowLeft' ? -1 : 1) : 0
        if (slides[i]) { selectSlide(slides[i].id); setReveal({ slide: slides[i].id }) }
      }
      else if (e.key === 'ArrowUp') {
        const s = sel ?? slides[0]
        if (!sel) selectSlide(s.id)
        setReveal({ slide: s.id, fill: true })
      }
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
      e.dataTransfer.setDragImage(k, clamp((e.clientX - r.left) / r.width, 0, 1) * k.width, clamp((e.clientY - r.top) / r.height, 0, 1) * k.height)
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

  const move = (sel: Slide, dir: -1 | 1) => moveTo(slides.indexOf(sel), slides.indexOf(sel) + dir)

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
      <Resizer edge="right" set={(x) => setToolsW(clamp(x, 180, 420))} />
      <aside className="tools">
        <Palette insert={insert} onDevice={setDeviceMenu} />

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

      <Board fitKey={`${target.platform}-${target.size}-${!!target.landscape}`} onEmptyClick={() => selectSlide(null)} reveal={reveal}>
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
              badges={badgesOf(s)}
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
        <button className="add-slide" title="Add a slide" aria-label="Add a slide" style={{ aspectRatio: `${size[0]} / ${size[1]}` }} onClick={addSlide}>
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </Board>
      {deviceMenu && (
        <Menu at={deviceMenu} onClose={() => setDeviceMenu(null)}>
          {[...new Set(DEVICES.map((d) => d.family))].map((f, n) => (
            <Fragment key={f}>
              {n > 0 && <hr />}
              <span className="menu-head">{f}</span>
              {DEVICES.filter((d) => d.family === f).map((d) => <button key={d.id} onClick={() => insertDevice(d.id)}>{d.label}</button>)}
            </Fragment>
          ))}
        </Menu>
      )}
      {addMenu && (
        <Menu at={addMenu} onClose={() => setAddMenu(null)}>
          {missing.map((p) => <button key={p} onClick={() => addPlatform(p)}>Add {PLATFORMS[p].label}</button>)}
        </Menu>
      )}
      {menu && (
        <Menu at={menu} onClose={() => setMenu(null)}>
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
          <button onClick={undo} disabled={!canUndo}>Undo<kbd>⌘Z</kbd></button>
          {sel && <>
            <hr />
            <button onClick={() => move(sel, -1)} disabled={slides.indexOf(sel) === 0}>Move slide left</button>
            <button onClick={() => move(sel, 1)} disabled={slides.indexOf(sel) === slides.length - 1}>Move slide right</button>
            <button onClick={() => removeSlide(sel)} disabled={slides.length === 1}>Delete slide</button>
          </>}
        </Menu>
      )}

      <aside className="side">
        <Resizer edge="left" set={(x) => setSideW(clamp(window.innerWidth - x, 260, 700))} />
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
              fetchShot={(id) => fetchShot.current?.(id)}
              shotIdUser={(id, part) => {
                const x = shotIdsOf(project).find((x) => x.id === id && !(x.s.id === sel.id && x.part === part && x.lang === textLang))
                return x ? `${PLATFORMS[x.t.platform].label} slide ${x.i + 1} (${partName(x.s, x.part)}${x.lang ? `, ${languageName(x.lang)}` : ''})` : null
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
      <Cheatsheet />
    </div>
  )
}
