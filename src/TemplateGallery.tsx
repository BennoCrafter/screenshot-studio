import { useEffect, useRef, useState } from 'react'
import { loadImage, withFonts, type ProjectFont } from './project'
import { drawSlide, layersOf, PLATFORMS, sizeOf, type Platform, type Slide } from './render'
import { loadCustom, saveCustom, toTarget, type Template, type TargetData } from './templates'
import macShot from './builtin/fillers/mac.jpg'

// filler screenshots, so a preview's devices show an app instead of a blank screen (credits in builtin/fillers/)
const PHONE_SHOTS = Object.values(import.meta.glob<string>('./builtin/fillers/phone-*.jpg', { eager: true, query: '?url', import: 'default' }))
const load = (urls: string[]) => Promise.all(urls.map(async (u) => loadImage(await (await fetch(u)).blob())))
let fillers: Promise<{ phone: HTMLImageElement[]; mac: HTMLImageElement[] }> | undefined
const getFillers = () => (fillers ??= Promise.all([load(PHONE_SHOTS), load([macShot])]).then(([phone, mac]) => ({ phone, mac })))

/** The template's first slides drawn small, its own screenshots or fillers in the devices; color swatches until they're ready. */
function Preview({ data, fonts, count, height = 240 }: { data: TargetData; fonts?: ProjectFont[]; count: number; height?: number }) {
  const [slides, setSlides] = useState<Slide[]>()
  useEffect(() => {
    let live = true
    Promise.all([toTarget({ ...data, slides: data.slides.slice(0, count) }), getFillers(), withFonts({ fonts })]).then(([t, f]) => {
      const pool = data.platform === 'mac' ? f.mac : f.phone
      const fill = (n: number) => pool[n % pool.length]
      if (live) setSlides(t.slides.map((s, i) => ({
        ...s, image: s.image ?? fill(i), outerImage: s.outerImage ?? fill(i),
        items: s.items?.map((it) => (it.kind === 'device' ? { ...it, image: it.image ?? fill(i + 1), outerImage: it.outerImage ?? fill(i + 1) } : it)),
      })))
    })
    return () => { live = false }
  }, [data, fonts, count])
  if (slides) return slides.map((s, i) => <Thumb key={i} s={s} size={sizeOf(data)} height={height} />)
  return data.slides.slice(0, count).map((s, i) => (
    <span key={i} style={{ background: `linear-gradient(${s.angle}deg, ${s.bg1}, ${s.bg2})`, color: s.textColor }}>
      {layersOf(s).map((p) => s.items?.find((i) => i.id === p && i.kind === 'text')?.text).find(Boolean)}
    </span>
  ))
}

function Thumb({ s, size: [w, h], height }: { s: Slide; size: readonly [number, number]; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    c.height = height // about twice the shown height, for sharp Retina thumbnails
    c.width = Math.round((w / h) * c.height)
    drawSlide(c.getContext('2d')!, s, c.width, c.height)
  }, [s, w, h, height])
  return <canvas ref={ref} />
}

/** A template tile: its first slides as previews, plus name, platforms and who made it. */
export function TemplateCard({ t, platform, selected, onPick, onDelete }: {
  t: Template
  platform?: Platform
  selected?: boolean
  onPick: () => void
  onDelete?: () => void
}) {
  const shown = (platform && t.targets[platform]) || Object.values(t.targets)[0]!
  const wide = shown.platform === 'mac'
  return (
    <div className={selected ? 'tpl-card selected' : 'tpl-card'}>
      <button className={wide ? 'tpl-preview wide' : 'tpl-preview'} onClick={onPick}>
        <Preview data={shown} fonts={t.fonts} count={wide ? 2 : 4} />
      </button>
      <div className="tpl-meta">
        <strong>{t.name}</strong>
        <small>{(Object.keys(t.targets) as Platform[]).map((p) => PLATFORMS[p].label).join(' · ')}{t.author && ` · by ${t.author}`}</small>
      </div>
      {onDelete && <button className="tpl-delete" onClick={onDelete} title="Delete template">×</button>}
    </div>
  )
}

/** A template from Open Screenshot Generator's catalog: their picture of its screens. */
export function StoreCard({ name, preview, selected, loading, onPick }: { name: string; preview: string; selected?: boolean; loading?: boolean; onPick: () => void }) {
  return (
    <div className={selected ? 'tpl-card selected' : 'tpl-card'}>
      <button className="tpl-preview" onClick={onPick}><img src={preview} alt="" loading="lazy" /></button>
      <div className="tpl-meta">
        <strong>{name}</strong>
        <small>{loading ? 'Loading…' : 'by Open Screenshot Generator'}</small>
      </div>
    </div>
  )
}

/** Every slide of a template's set, large. */
export const BigPreview = ({ data, fonts }: { data: TargetData; fonts?: ProjectFont[] }) => <Preview data={data} fonts={fonts} count={data.slides.length} height={1200} />

/** Saved templates, kept in sync with storage (a file on the desktop, localStorage in the browser). */
export function useCustomTemplates() {
  const [custom, setCustom] = useState<Template[]>([])
  useEffect(() => {
    loadCustom().then(setCustom)
  }, [])
  const store = (list: Template[]) => {
    setCustom(list)
    saveCustom(list)
  }
  return [custom, store] as const
}
