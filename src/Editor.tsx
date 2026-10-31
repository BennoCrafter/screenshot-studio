import { useEffect, useRef, useState } from 'react'
import { Board } from './Board'
import { DEVICES, DEVICE_BY_ID } from './devices/models'
import type { DevicePose } from './devices/render3d'
import { Chat } from './Chat'
import { Themes } from './Themes'
import { openSettings } from './Settings'
import { animate } from './motion'
import { ask, isDesktop, saveFile } from './native'
import { LANGUAGES, languageName, languagesOf, loadImage, PROJECT_FILE, projectToFile, type Project } from './project'
import { added, isDevice, isText, isTextPart, itemOf, missingBuiltIns, moved, newItem, partName, removed, reset, resized, restack, rotated, shotOf, withShot, withText, type Shot } from './elements'
import { layersOf, localize, PLATFORMS, SIZES, type Item, type Part, type Platform, type SizeName, type Slide, type Style, type Target } from './render'
import { SlideCanvas } from './SlideCanvas'
import { Export } from './Export'
import { adaptTarget, ALL_PLATFORMS, poseFor } from './templates'

type Updater<T> = (fn: (v: T) => T) => void
/** One element on one slide. */
type Sel = { slide: string; part: Part }
const same = (a: Sel, b: Sel) => a.slide === b.slide && a.part === b.part
const typing = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea, select, [contenteditable]')

// Copied elements, kept across projects; ponytail: in-app only, the system clipboard holds just typed text
let clipboard: { part: Part; slide: Slide; text: string }[] = []

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
  const imageInput = useRef<HTMLInputElement>(null)
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
  const size = SIZES[target.size]
  const sel = slides.find((s) => s.id === selection.at(-1)?.slide) ?? null
  const langs = languagesOf(project)
  const [picked, setLang] = useState(langs[0])
  const lang = langs.includes(picked) ? picked : langs[0]
  const [tab, setTab] = useState<'inspector' | 'chat'>('inspector')
  const langDialog = useRef<HTMLDialogElement>(null)

  const setTarget = (fn: (t: Target) => Target) =>
    setProject((p) => ({ ...p, targets: p.targets.map((t) => (t.platform === target.platform ? fn(t) : t)) }))
  const setSlides = (fn: (s: Slide[]) => Slide[]) => setTarget((t) => ({ ...t, slides: fn(t.slides) }))
  const setSizeName = (size: SizeName) => setTarget((t) => ({ ...t, size }))

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
  const textOf = (s: Slide) => (lang === langs[0] ? s : s.translations?.[lang] ?? { title: '', subtitle: '' })
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
  const grab = (s0: Slide, part: Part) => (ratio: number) =>
    setSlides((all) => all.map((s) => (s.id === s0.id ? { ...s, ...resized(s0, s, part, ratio) } : s)))

  /** Applies `fn` to every picked element that's on its slide. */
  const eachPicked = (fn: (s: Slide, part: Part) => Partial<Slide>) =>
    setSlides((all) => all.map((s) => selection.filter((x) => x.slide === s.id && layersOf(s).includes(x.part))
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
  /** Adds an object (or puts back a deleted built-in) on each picked slide, or the first; a new text is ready to type. */
  const insert = (make: (s: Slide) => Item | Part) => {
    const ids = new Set(selection.map((x) => x.slide))
    const made = new Map(slides.filter((s, i) => (ids.size ? ids.has(s.id) : i === 0)).map((s) => [s.id, make(s)]))
    setSlides((all) => all.map((s) => (made.has(s.id) ? { ...s, ...added(s, made.get(s.id)!) } : s)))
    const picked = [...made].map(([slide, p]) => ({ slide, part: typeof p === 'string' ? p : p.id }))
    setSelection(picked)
    const first = [...made.values()][0]
    setEditing(typeof first !== 'string' && first.kind === 'text' ? picked[0] : null)
  }
  // a device mockup puts back the slide's own device if it was deleted, else adds another
  const insertDevice = () => insert((s) => layersOf(s).includes('device')
    ? newItem('device', undefined, poseFor(target.platform, { size: PLATFORMS[target.platform].device.size! * 0.7 }))
    : 'device')

  const copy = () => {
    const picked = selection.flatMap(({ slide, part }) => {
      const s = slides.find((s) => s.id === slide)
      if (!s || !layersOf(s).includes(part)) return []
      const local = localize(s, lang)
      return [{ part, slide: s, text: part === 'title' || part === 'subtitle' ? local[part] : itemOf(local, part)?.text ?? '' }]
    })
    if (picked.length) clipboard = picked
  }
  // a built-in pasted onto a slide replaces its own (words and placement, or the device and its screenshots);
  // an added object is pasted as a new one, nudged when it lands on the slide it came from
  const paste = () => {
    const targets = new Set(selection.map((x) => x.slide))
    if (!clipboard.length || !targets.size) return
    const picked: Sel[] = []
    setSlides((all) => all.map((s) => !targets.has(s.id) ? s : clipboard.reduce((s, { part, slide, text }) => {
      const item = itemOf(slide, part)
      if (item) {
        const nudge = slide.id === s.id ? 0.03 : 0
        const copy = { ...item, id: crypto.randomUUID(), x: item.x + nudge, y: item.y + nudge }
        picked.push({ slide: s.id, part: copy.id })
        return { ...s, ...added(s, copy) }
      }
      picked.push({ slide: s.id, part })
      const s2 = { ...s, ...added(s, part) }
      if (part === 'device') return { ...s2, device: { ...slide.device }, image: slide.image, outerImage: slide.outerImage }
      return { ...s2, ...withText(s2, part, text, textLang), [`${part}Box`]: slide[`${part as 'title'}Box`] }
    }, s)))
    setSelection(picked)
  }
  /** The picked elements on slide `fromId` moved onto `toId`, which sits (dx, dy) slide sizes away, keeping where they
   *  are on screen. Text in every language goes along; a headline, subtitle or device replaces the one already there. */
  const transfer = (fromId: string, toId: string, dx: number, dy: number) => {
    const parts = selection.filter((x) => x.slide === fromId).map((x) => x.part)
    setSlides((all) => {
      let src = all.find((s) => s.id === fromId)!, to = all.find((s) => s.id === toId)!
      for (const part of parts) {
        if (!layersOf(src).includes(part)) continue
        to = { ...to, ...added(to, itemOf(src, part) ?? part) }
        if (part === 'device') to = { ...to, device: src.device, image: src.image, outerImage: src.outerImage }
        if (isTextPart(part)) to = { ...to, [part]: src[part], [`${part}Box`]: src[`${part}Box`] }
        for (const [l, t] of Object.entries(src.translations ?? {})) {
          const text = isTextPart(part) ? t[part] : t.items?.[part]
          if (text) to = { ...to, ...withText(to, part, text, l) }
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

  // Esc clears the selection, so the board is in focus with nothing picked; ⌘Z/⇧⌘Z undo and redo, ⌘C/⌘V/⌘D copy, paste and
  // duplicate, ⌘A picks every element, Delete removes the picked ones
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  const applyTheme = ({ bg1, bg2, angle, textColor, layout }: Style) =>
    setSlides((all) => all.map((s) => ({ ...s, bg1, bg2, angle, textColor, layout })))

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

  // Dragging a slide carries a thumbnail of it, and the others make room as it passes over them.
  const dragStart = (e: React.DragEvent, i: number) => {
    e.dataTransfer.effectAllowed = 'move'
    const src = document.querySelector<HTMLCanvasElement>(`canvas[data-slide="${slides[i].id}"]`)
    if (src) {
      const k = document.createElement('canvas')
      k.width = 120
      k.height = (120 * src.height) / src.width
      k.getContext('2d')!.drawImage(src, 0, 0, k.width, k.height)
      k.style.cssText = 'position:fixed;left:-9999px;border-radius:8px'
      document.body.append(k)
      e.dataTransfer.setDragImage(k, k.width / 2, k.height / 2)
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

  const saveToFile = async () => saveFile(`${project.name}.ssproj`, await projectToFile(project), PROJECT_FILE)

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
        <Themes current={sel ?? slides[0]} title={localize(sel ?? slides[0], lang).title.split('\n')[0] || 'Your app'} onApply={applyTheme} />
        <label title="The pixel size the PNGs are exported at. The App Store asks for one of these per device class; the first is the one it requires.">
          Export size
          <select value={target.size} onChange={(e) => setSizeName(e.target.value as SizeName)}>
            {PLATFORMS[target.platform].sizes.map((n) => (
              <option key={n} value={n}>{n} · {SIZES[n][0]}×{SIZES[n][1]}</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button onClick={openSettings} title="Settings (⌘,)" aria-label="Settings"><Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></button>
        <button onClick={saveToFile} title="Save the project, screenshots included, to a .ssproj file">Save File…</button>
        <button onClick={addSlide}>Add slide</button>
        <Export project={project} />
      </header>

      <nav className="langbar">
        <span className="platform-tabs">
          {langs.map((l, i) => (
            <span key={l} className={l === lang ? 'on' : ''}>
              <button onClick={() => animate(() => setLang(l))} title={i === 0 ? 'Primary language' : undefined}>{languageName(l)}</button>
              {l === lang && i > 0 && <button className="tab-x" onClick={() => removeLanguage(l)} title="Remove this language">×</button>}
            </span>
          ))}
          <button onClick={() => langDialog.current!.showModal()} title="Add a language. Only the text differs between languages.">+</button>
        </span>
        <LanguageDialog dialog={langDialog} have={langs} onAdd={addLanguage} />
      </nav>

      <aside className="tools">
        <Resizer edge="right" set={(x) => setToolsW(Math.min(420, Math.max(180, x)))} />
        <h3>Add</h3>
        <div className="add-grid">
          <button onClick={() => insert(() => newItem('text'))}><Icon d="M5 6V4h14v2M12 4v16M9 20h6" />Text</button>
          <button onClick={() => imageInput.current!.click()}><Icon d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01" />Image</button>
          <button onClick={insertDevice}><Icon d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2" />Device</button>
          <button onClick={() => insert(() => newItem('rect'))}><Icon d="M4 6h16v12H4z" />Rectangle</button>
          <button onClick={() => insert(() => newItem('ellipse'))}><Icon d="M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z" />Ellipse</button>
          <input ref={imageInput} type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const img = await loadImage(f)
            insert(() => newItem('image', img))
          }} />
        </div>
        {missingBuiltIns(sel ?? slides[0]).filter((p) => p !== 'device').map((p) => (
          <button key={p} className="restore" onClick={() => insert(() => p)}>Restore {partName(sel ?? slides[0], p).toLowerCase()}</button>
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
              <button onClick={() => selectSlide(s.id)} title="Drag to reorder"><b>{i + 1}</b><span>{localize(s, lang).title.split('\n')[0] || 'Untitled'}</span></button>
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
            {(() => {
              const item = selection.length === 1 ? itemOf(sel, selection[0].part) : undefined
              return item && item.kind !== 'image' && item.kind !== 'device' && (
                <label>
                  Colour
                  <input type="color" value={item.color ?? sel.textColor} onChange={(e) =>
                    update(sel.id, { items: sel.items!.map((i) => (i.id === item.id ? { ...i, color: e.target.value } : i)) })} />
                </label>
              )
            })()}
          </>
        )}
      </aside>

      <Board fitKey={`${target.platform}-${target.size}`} onEmptyClick={() => selectSlide(null)}>
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
              onGrab={(part) => grab(s, part)}
              onMenu={(_, x, y) => setMenu({ x, y })}
              onEdit={(part) => setEditing(part ? { slide: s.id, part } : null)}
              onEditText={(part, text) => setText(s, part, text)}
              onRotate={(part, deg) => update(s.id, rotated(s, part, deg))}
              onTransfer={(to, dx, dy) => transfer(s.id, to, dx, dy)}
              onShot={(part, patch) => update(s.id, withShot(s, part, patch))}
            />
            {s.id === sel?.id && (
              <div className="slide-bar" onPointerDown={(e) => e.stopPropagation()}>
                <span className="handle" draggable title="Drag to move this slide" onDragStart={(e) => dragStart(e, i)} onDragEnd={() => setDragged(null)}>
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
            <span className={tab === 'chat' ? 'on' : ''}><button onClick={() => setTab('chat')}>Claude</button></span>
          </nav>
        )}
        <div className="inspector" hidden={tab !== 'inspector'}>
          {sel ? (
            <SlideInspector
              key={sel.id}
              sel={sel}
              device={selection.length === 1 && isDevice(sel, selection[0].part) && layersOf(sel).includes(selection[0].part) ? selection[0].part : 'device'}
              text={textOf(sel)}
              placeholder={lang === langs[0] ? undefined : sel}
              setText={(patch) => Object.entries(patch).forEach(([p, t]) => setText(sel, p, t))}
              index={slides.indexOf(sel)}
              count={slides.length}
              update={(patch) => update(sel.id, patch)}
              move={(dir) => move(sel, dir)}
              remove={() => removeSlide(sel)}
            />
          ) : (
            <>
              <h2>{PLATFORMS[target.platform].label}</h2>
              <p className="hint">Click a slide to edit it. Click empty board space or press Esc to clear the selection.</p>
            </>
          )}
        </div>
        {isDesktop && <Chat hidden={tab !== 'chat'} />}
      </aside>
    </div>
  )
}

function SlideInspector({ sel, device, text, placeholder, setText, index, count, update, move, remove }: {
  sel: Slide
  device: Part // the device the device controls change: the picked one, or the slide's own
  text: Pick<Slide, 'title' | 'subtitle'>
  placeholder?: Pick<Slide, 'title' | 'subtitle'> // the primary language's text, when editing another
  setText: (patch: Partial<Pick<Slide, 'title' | 'subtitle'>>) => void
  index: number
  count: number
  update: (patch: Partial<Slide>) => void
  move: (dir: -1 | 1) => void
  remove: () => void
}) {
  const shot = shotOf(sel, device), pose = shot.device
  const setShot = (patch: Partial<Shot>) => update(withShot(sel, device, patch))
  const setDevice = (patch: Partial<DevicePose>) => setShot({ device: { ...pose, ...patch } })
  const model = DEVICE_BY_ID[pose.model]
  const families = [...new Set(DEVICES.map((d) => d.family))]
  return (
    <div className="inspector-body">
      <h2>Slide {index + 1}</h2>
      <label>
        Headline
        <textarea rows={2} value={text.title} placeholder={placeholder?.title} onChange={(e) => setText({ title: e.target.value })} />
      </label>
      <label>
        Subtitle
        <textarea rows={2} value={text.subtitle} placeholder={placeholder?.subtitle} onChange={(e) => setText({ subtitle: e.target.value })} />
      </label>
      <label>
        Screenshot
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) setShot({ image: await loadImage(f) })
          }}
        />
      </label>
      {model.outer && (
        <label>
          Outer screenshot (shown when closed)
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) setShot({ outerImage: await loadImage(f) })
            }}
          />
        </label>
      )}
      <label>
        Device
        <select value={model.id} onChange={(e) => setDevice({ model: e.target.value, finish: DEVICE_BY_ID[e.target.value].finishes[0].id })}>
          {families.map((f) => (
            <optgroup key={f} label={f}>
              {DEVICES.filter((d) => d.family === f).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        Finish
        <select value={pose.finish} onChange={(e) => setDevice({ finish: e.target.value })}>
          {model.finishes.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <p className="hint">Drag the device to move it, the round grip in its middle to turn it, the second grip on a foldable or Mac to fold it, the corners to resize and the top handle to spin. Shift snaps to 15°.</p>
      <label>
        Device size · {Math.round(pose.size * 100)}%
        <input type="range" min={0.3} max={1.2} step={0.01} value={pose.size} onChange={(e) => setDevice({ size: +e.target.value })} />
      </label>
      <label>
        Turn · {pose.yaw}°
        <input type="range" min={-180} max={180} value={pose.yaw} onChange={(e) => setDevice({ yaw: +e.target.value })} />
      </label>
      <label>
        Spin · {pose.roll ?? 0}°
        <input type="range" min={-180} max={180} value={pose.roll ?? 0} onChange={(e) => setDevice({ roll: +e.target.value })} />
      </label>
      <label>
        Tilt · {pose.pitch}°
        <input type="range" min={-90} max={90} value={pose.pitch} onChange={(e) => setDevice({ pitch: +e.target.value })} />
      </label>
      {(model.fold || model.laptop) && (
        <label>
          {model.laptop ? 'Lid' : 'Fold'} · {pose.fold}°
          <input type="range" min={0} max={180} value={pose.fold} onChange={(e) => setDevice({ fold: +e.target.value })} />
        </label>
      )}
      <label>
        Layout
        <select value={sel.layout} onChange={(e) => update({ layout: e.target.value as Slide['layout'] })}>
          <option value="text-top">Text on top</option>
          <option value="text-bottom">Text at bottom</option>
        </select>
      </label>
      <div className="row">
        <label>Background<input type="color" value={sel.bg1} onChange={(e) => update({ bg1: e.target.value })} /></label>
        <label>&nbsp;<input type="color" value={sel.bg2} onChange={(e) => update({ bg2: e.target.value })} /></label>
        <label>Text<input type="color" value={sel.textColor} onChange={(e) => update({ textColor: e.target.value })} /></label>
      </div>
      <label>
        Gradient angle · {sel.angle}°
        <input type="range" min={0} max={360} value={sel.angle} onChange={(e) => update({ angle: +e.target.value })} />
      </label>
      <div className="row">
        <button onClick={() => move(-1)} disabled={index === 0} title="Move slide left">← Move</button>
        <button onClick={() => move(1)} disabled={index === count - 1} title="Move slide right">Move →</button>
        <button className="danger" onClick={remove} disabled={count === 1}>Delete slide</button>
      </div>
    </div>
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
