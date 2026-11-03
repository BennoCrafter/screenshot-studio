import { useRef, useState } from 'react'
import { ask } from './native'
import type { Style } from './render'
import { deleteTheme, loadThemes, saveTheme, type Theme } from './templates'

/** A theme as a tiny slide: its gradient, a headline and a phone. */
function Preview({ t, title }: { t: Style; title: string }) {
  return (
    <div className="theme-preview" style={{ background: `linear-gradient(${t.angle}deg, ${t.bg1}, ${t.bg2})`, color: t.textColor }}>
      <b>{title}</b>
      <i style={{ borderColor: t.textColor }} />
    </div>
  )
}

/** The Theme button and its dialog: pick a theme for every slide of this platform, or make your own. */
export function Themes({ current, title, onApply }: { current: Style; title: string; onApply: (t: Style) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [themes, setThemes] = useState<Theme[]>([])
  const [draft, setDraft] = useState<Theme | null>(null)
  const reload = () => loadThemes().then(setThemes) // on every open, so themes an agent saved show up

  const pick = (t: Style) => {
    onApply(t)
    dialog.current!.close()
  }
  const save = async () => {
    if (!draft?.name.trim()) return
    const t = { ...draft, name: draft.name.trim() }
    await saveTheme(t)
    await reload()
    setDraft(null)
    pick(t)
  }
  const { bg1, bg2, angle, textColor } = current

  return (
    <>
      <button onClick={() => { reload(); setDraft(null); dialog.current!.showModal(); dialog.current!.focus() }}>Theme</button>
      <dialog ref={dialog} tabIndex={-1} className="tpl-dialog themes-dialog" onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
        <header>
          <h2>{draft ? 'New theme' : 'Themes'}</h2>
          <button onClick={() => (draft ? setDraft(null) : dialog.current!.close())}>{draft ? 'Back' : 'Close'}</button>
        </header>
        {draft ? (
          <form className="theme-editor" onSubmit={(e) => { e.preventDefault(); save() }}>
            <Preview t={draft} title={title} />
            <div className="theme-fields">
              <label>Name<input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="My theme" /></label>
              <div className="row">
                <label>Top<input type="color" value={draft.bg1} onChange={(e) => setDraft({ ...draft, bg1: e.target.value })} /></label>
                <label>Bottom<input type="color" value={draft.bg2} onChange={(e) => setDraft({ ...draft, bg2: e.target.value })} /></label>
                <label>Text<input type="color" value={draft.textColor} onChange={(e) => setDraft({ ...draft, textColor: e.target.value })} /></label>
              </div>
              <label>
                Gradient angle · {draft.angle}°
                <input type="range" min={0} max={360} value={draft.angle} onChange={(e) => setDraft({ ...draft, angle: +e.target.value })} />
              </label>
              <button type="submit" className="primary" disabled={!draft.name.trim()}>Save and apply</button>
              <p className="hint">Saving under an existing name of your own replaces it.</p>
            </div>
          </form>
        ) : (
          <>
            <p className="hint">Applies to every slide on this platform. Only the colors change.</p>
            <div className="theme-grid">
              <button className="theme-card new" onClick={() => setDraft({ name: '', bg1, bg2, angle, textColor })}>
                <span>+</span>New theme<small>from this slide</small>
              </button>
              {themes.map((t) => (
                <div key={t.name} className="theme-card">
                  <button onClick={() => pick(t)}><Preview t={t} title={title} />{t.name}</button>
                  {t.custom && (
                    <span className="theme-actions">
                      <button title="Edit" onClick={() => setDraft(t)}>Edit</button>
                      <button title="Delete" onClick={async () => { if (await ask(`Delete the theme “${t.name}”?`)) { await deleteTheme(t.name); reload() } }}>×</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </dialog>
    </>
  )
}
