import { useEffect, useState } from 'react'
import { Board } from './Board'
import { DEVICES, DEVICE_BY_ID } from './devices/models'
import type { DevicePose } from './devices/render3d'
import { ask, saveFile, saveFiles } from './native'
import { loadImage, PROJECT_FILE, projectToFile, type Project } from './project'
import { PLATFORMS, SIZES, THEMES, type Platform, type SizeName, type Slide, type Target } from './render'
import { SlideCanvas } from './SlideCanvas'
import { Templates } from './TemplateGallery'
import { adaptTarget, ALL_PLATFORMS, toData, toTarget, type Template } from './templates'

type Updater<T> = (fn: (v: T) => T) => void

export function Editor({ project, setProject, onClose }: { project: Project; setProject: Updater<Project>; onClose: () => void }) {
  const [ti, setTi] = useState(0)
  const target = project.targets[Math.min(ti, project.targets.length - 1)]
  const slides = target.slides
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const size = SIZES[target.size]
  const sel = slides.find((s) => s.id === selectedId) ?? null

  const setTarget = (fn: (t: Target) => Target) =>
    setProject((p) => ({ ...p, targets: p.targets.map((t) => (t.platform === target.platform ? fn(t) : t)) }))
  const setSlides = (fn: (s: Slide[]) => Slide[]) => setTarget((t) => ({ ...t, slides: fn(t.slides) }))
  const setSizeName = (size: SizeName) => setTarget((t) => ({ ...t, size }))

  const showTarget = (i: number) => {
    setTi(i)
    setSelectedId(null)
  }
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

  // Esc clears the selection, so the board is in focus with nothing picked
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLElement && e.target.matches('input, textarea, select'))) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const applyTheme = (name: string) =>
    setSlides((all) => all.map((s) => ({ ...s, ...THEMES[name] })))

  const applyTemplate = (t: Template) => {
    const data = t.targets[target.platform]
    if (!data) return
    const next = toTarget(data, slides)
    setTarget(() => next)
    setSelectedId(next.slides[0].id)
  }

  const addSlide = () => {
    const s = { ...(sel ?? slides[slides.length - 1]), id: crypto.randomUUID(), image: null, outerImage: null }
    setSlides((all) => [...all, s])
    setSelectedId(s.id)
  }

  const removeSlide = (sel: Slide) => {
    if (slides.length === 1) return
    const rest = slides.filter((s) => s.id !== sel.id)
    setSlides(() => rest)
    setSelectedId(rest[0].id)
  }

  const move = (sel: Slide, dir: -1 | 1) => {
    const i = slides.indexOf(sel), j = i + dir
    if (j < 0 || j >= slides.length) return
    const next = [...slides]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSlides(() => next)
  }

  // ponytail: one PNG per slide (a folder on desktop, downloads on the web); add a zip when exporting many sizes at once
  const exportAll = async () => {
    const files = await Promise.all(slides.map(async (s, i) => {
      const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-slide="${s.id}"]`)!
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
      return { name: `${project.name}-${target.platform}-${i + 1}-${size[0]}x${size[1]}.png`, blob }
    }))
    await saveFiles(files)
  }

  const saveToFile = async () => saveFile(`${project.name}.ssproj`, await projectToFile(project), PROJECT_FILE)

  return (
    <div className="app">
      <header className="topbar">
        <button onClick={onClose} title="All projects">‹ Projects</button>
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
            <select value="" onChange={(e) => addPlatform(e.target.value as Platform)} title="Add a platform, starting from this one's slides">
              <option value="" disabled>+</option>
              {missing.map((p) => <option key={p} value={p}>Add {PLATFORMS[p].label}</option>)}
            </select>
          )}
        </nav>
        <Templates
          platform={target.platform}
          onApply={applyTemplate}
          current={() => ({ targets: Object.fromEntries(project.targets.map((t) => [t.platform, { platform: t.platform, size: t.size, slides: t.slides.map(toData) }])) })}
        />
        <label>
          Theme
          <select value="" onChange={(e) => applyTheme(e.target.value)}>
            <option value="" disabled>Apply…</option>
            {Object.keys(THEMES).map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Size
          <select value={target.size} onChange={(e) => setSizeName(e.target.value as SizeName)}>
            {PLATFORMS[target.platform].sizes.map((n) => (
              <option key={n} value={n}>{n} · {SIZES[n][0]}×{SIZES[n][1]}</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button onClick={saveToFile} title="Save the project, screenshots included, to a .ssproj file">Save File…</button>
        <button onClick={addSlide}>Add slide</button>
        <button className="primary" onClick={exportAll}>Export PNGs</button>
      </header>

      <Board fitKey={`${target.platform}-${target.size}`} onEmptyClick={() => setSelectedId(null)}>
        {slides.map((s) => (
          <SlideCanvas
            key={s.id}
            slide={s}
            size={size}
            selected={s.id === sel?.id}
            onSelect={() => setSelectedId(s.id)}
            onImage={(patch) => update(s.id, patch)}
            onDevice={(patch) => update(s.id, { device: { ...s.device, ...patch } })}
          />
        ))}
      </Board>

      {sel ? (
        <SlideInspector
          sel={sel}
          index={slides.indexOf(sel)}
          count={slides.length}
          update={(patch) => update(sel.id, patch)}
          move={(dir) => move(sel, dir)}
          remove={() => removeSlide(sel)}
        />
      ) : (
        <aside className="inspector">
          <h2>{PLATFORMS[target.platform].label}</h2>
          <p className="hint">Click a slide to edit it. Click empty board space or press Esc to clear the selection.</p>
        </aside>
      )}
    </div>
  )
}

function SlideInspector({ sel, index, count, update, move, remove }: {
  sel: Slide
  index: number
  count: number
  update: (patch: Partial<Slide>) => void
  move: (dir: -1 | 1) => void
  remove: () => void
}) {
  const setDevice = (patch: Partial<DevicePose>) => update({ device: { ...sel.device, ...patch } })
  const model = DEVICE_BY_ID[sel.device.model]
  const families = [...new Set(DEVICES.map((d) => d.family))]
  return (
    <aside className="inspector">
      <h2>Slide {index + 1}</h2>
      <label>
        Headline
        <textarea rows={2} value={sel.title} onChange={(e) => update({ title: e.target.value })} />
      </label>
      <label>
        Subtitle
        <textarea rows={2} value={sel.subtitle} onChange={(e) => update({ subtitle: e.target.value })} />
      </label>
      <label>
        Screenshot
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) update({ image: await loadImage(f) })
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
              if (f) update({ outerImage: await loadImage(f) })
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
        <select value={sel.device.finish} onChange={(e) => setDevice({ finish: e.target.value })}>
          {model.finishes.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <p className="hint">Drag the device to move it, the round grip in its middle to turn it, the second grip on a foldable or Mac to fold it, the corners to resize and the top handle to spin. Shift snaps to 15°.</p>
      <label>
        Device size · {Math.round(sel.device.size * 100)}%
        <input type="range" min={0.3} max={1.2} step={0.01} value={sel.device.size} onChange={(e) => setDevice({ size: +e.target.value })} />
      </label>
      <label>
        Turn · {sel.device.yaw}°
        <input type="range" min={-180} max={180} value={sel.device.yaw} onChange={(e) => setDevice({ yaw: +e.target.value })} />
      </label>
      <label>
        Spin · {sel.device.roll ?? 0}°
        <input type="range" min={-180} max={180} value={sel.device.roll ?? 0} onChange={(e) => setDevice({ roll: +e.target.value })} />
      </label>
      <label>
        Tilt · {sel.device.pitch}°
        <input type="range" min={-90} max={90} value={sel.device.pitch} onChange={(e) => setDevice({ pitch: +e.target.value })} />
      </label>
      {(model.fold || model.laptop) && (
        <label>
          {model.laptop ? 'Lid' : 'Fold'} · {sel.device.fold}°
          <input type="range" min={0} max={180} value={sel.device.fold} onChange={(e) => setDevice({ fold: +e.target.value })} />
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
        <button onClick={() => move(-1)}>←</button>
        <button onClick={() => move(1)}>→</button>
        <button className="danger" onClick={remove} disabled={count === 1}>Delete</button>
      </div>
    </aside>
  )
}
