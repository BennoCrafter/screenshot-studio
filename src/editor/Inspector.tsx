// The editor's right panel: settings of the picked elements and their slides.

import { createContext, useContext, useRef, useState } from 'react'
import { DEVICES, DEVICE_BY_ID } from '../devices/models'
import type { DevicePose } from '../devices/render3d'
import { FONT_FILES, IMAGE_FILES, openFiles, tell } from '../lib/native'
import { fontFamily, languageName, loadImage, type ProjectFont } from '../model/project'
import { useStored } from '../settings/prefs'
import { isDevice, itemOf, kindOf, moved, partName, positionOf, shotIdOf, shotOf, withShot, withShotId, type Shot } from '../model/elements'
import { FONT, FONTS, type Item, type Part, type Slide } from '../model/render'

/** The picked element's settings (the last one, when several are picked), then the slide's own. */
export function SlideInspector({ sel, part, lang, setText, fonts, addFont, fontForAll, index, size, update, edit, likes, pickedSlides, updateSlides, shotIdUser, fetchShot }: {
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
  /** Where else in the project a screenshot ID is used, if anywhere: elements may share one. */
  shotIdUser: (id: string, part: Part) => string | null
  fetchShot: (id: string) => void // the screenshot folder's file for this ID, if any, applied now
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
    <ShotIdField key={`${part} ${lang}`} id={shotIdOf(sel, part, lang) ?? ''} lang={lang} user={(id) => shotIdUser(id, part)} set={(id) => update(withShotId(sel, part, id, lang))} fetch={fetchShot} />
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

/** An element's screenshot ID: a file of that name in the screenshot folder replaces its screenshot, on every element
 * with that ID. */
function ShotIdField({ id, lang, user, set, fetch }: { id: string; lang?: string; user: (id: string) => string | null; set: (id: string) => void; fetch: (id: string) => void }) {
  const [draft, setDraft] = useState(id)
  const was = useRef(id) // the ID when the field got focus: leaving it with a new one fetches that screenshot
  const shared = draft ? user(draft) : null
  return (
    <label title="A file named after this ID in the project's screenshot folder (Settings › Project) replaces this screenshot">
      Screenshot ID{lang && ` (${languageName(lang)})`}
      <input value={draft} onFocus={() => (was.current = draft)} onBlur={() => draft && draft !== was.current && fetch(draft)} placeholder={lang ? `e.g. home-screen-${lang}` : 'e.g. home-screen'} spellCheck={false} onChange={(e) => {
        const v = e.target.value.replace(/\s/g, '-')
        setDraft(v)
        set(v)
      }} />
      {shared && <small className="mixed">Also on {shared}</small>}
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
