import { useEffect, useState } from 'react'
import { PLATFORMS, type Platform } from './render'
import { loadCustom, saveCustom, type Template } from './templates'

/** A template tile: its first slides as colour swatches, plus name and platforms. */
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
        {shown.slides.slice(0, wide ? 2 : 4).map((s, i) => (
          <span key={i} style={{ background: `linear-gradient(${s.angle}deg, ${s.bg1}, ${s.bg2})`, color: s.textColor }}>
            {s.title}
          </span>
        ))}
      </button>
      <div className="tpl-meta">
        <strong>{t.name}</strong>
        <small>{(Object.keys(t.targets) as Platform[]).map((p) => PLATFORMS[p].label).join(' · ')}</small>
      </div>
      {onDelete && <button className="tpl-delete" onClick={onDelete} title="Delete template">×</button>}
    </div>
  )
}

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
