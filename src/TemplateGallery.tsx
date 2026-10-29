import { useEffect, useRef, useState } from 'react'
import { PLATFORMS, type Platform } from './render'
import { BUILT_IN, loadCustom, saveCustom, type Template } from './templates'

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

/** In-project template dialog: re-style the current platform, or save the whole project as a template. */
export function Templates({ platform, onApply, current }: {
  platform: Platform
  onApply: (t: Template) => void
  current: () => Pick<Template, 'targets'>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [custom, store] = useCustomTemplates()
  const [name, setName] = useState('')
  const fits = [...BUILT_IN, ...custom].filter((t) => t.targets[platform])

  const pick = (t: Template) => {
    onApply(t)
    dialog.current!.close()
  }

  return (
    <>
      <button onClick={() => dialog.current!.showModal()}>Templates</button>
      <dialog ref={dialog} className="tpl-dialog" onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
        <header>
          <h2>{PLATFORMS[platform].label} templates</h2>
          <button onClick={() => dialog.current!.close()}>Close</button>
        </header>
        <p className="hint">Applies to the {PLATFORMS[platform].label} slides only and keeps their screenshots, in slide order.</p>
        <div className="tpl-grid">
          {fits.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              platform={platform}
              onPick={() => pick(t)}
              onDelete={t.custom ? () => store(custom.filter((c) => c.id !== t.id)) : undefined}
            />
          ))}
        </div>

        <h3>Save this project as a template</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            store([...custom, { ...current(), id: crypto.randomUUID(), name: name.trim(), description: 'Saved from a project.', custom: true }])
            setName('')
          }}
        >
          <input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={!name.trim()}>Save</button>
        </form>
        <p className="hint">Saves every platform in this project, without screenshots.</p>
      </dialog>
    </>
  )
}
