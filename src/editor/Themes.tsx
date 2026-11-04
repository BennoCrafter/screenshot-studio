import { useEffect, useRef, useState } from 'react'
import { ask } from '../lib/native'
import { renderSlide, type Slide, type Style } from '../model/render'
import { deleteTheme, loadThemes, saveTheme, shareTheme, type Theme } from '../model/templates'

const PREVIEW_W = 220 // px it's rendered at, enough for the editor's big preview on a retina screen

/** The slide as it would export in theme `t`; its plain gradient shows while it renders. */
function Preview({ t, slide, size }: { t: Style; slide: Slide; size: readonly [number, number] }) {
  const { bg1, bg2, angle, textColor } = t
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let live = true, made = ''
    renderSlide({ ...slide, bg1, bg2, angle, textColor }, size, PREVIEW_W / size[0]).then((b) => {
      made = URL.createObjectURL(b)
      if (live) setUrl(made)
      else URL.revokeObjectURL(made)
    })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [slide, size, bg1, bg2, angle, textColor])
  return (
    <div className="theme-preview" style={{ aspectRatio: `${size[0]} / ${size[1]}`, background: `linear-gradient(${angle}deg, ${bg1}, ${bg2})` }}>
      {url && <img src={url} alt="" />}
    </div>
  )
}

const same = (a: Style, b: Style) =>
  a.bg1.toLowerCase() === b.bg1.toLowerCase() && a.bg2.toLowerCase() === b.bg2.toLowerCase() && a.angle === b.angle && a.textColor.toLowerCase() === b.textColor.toLowerCase()

/** The Theme button and its dialog: pick a theme for every slide of this platform, or make your own. */
export function Themes({ size, current, onApply }: { size: readonly [number, number]; current: Slide; onApply: (t: Style) => void }) {
  const [shown, setShown] = useState<Slide | null>(null) // the slide as it was on opening; previews render only while open
  const dialog = useRef<HTMLDialogElement>(null)
  const [themes, setThemes] = useState<Theme[]>([])
  const [draft, setDraft] = useState<Theme | null>(null)
  const [status, setStatus] = useState('')
  const reload = () => loadThemes().then(setThemes) // on every open, so themes an agent saved show up

  const pick = (t: Style) => {
    onApply(t)
    dialog.current!.close()
  }
  // saving only stores the theme; picking it is what applies it
  const save = async () => {
    if (!draft?.name.trim()) return
    await saveTheme({ ...draft, name: draft.name.trim() })
    await reload()
    setDraft(null)
    setStatus(`Saved “${draft.name.trim()}”. Click it to apply.`)
  }
  const share = async (t: Theme) => {
    try {
      setStatus(await shareTheme(t))
    } catch (e) {
      setStatus(`Couldn't open GitHub: ${e}`)
    }
  }
  const { bg1, bg2, angle, textColor } = current
  const card = (t: Theme) => (
    <div key={t.name} className={`theme-card ${same(t, current) ? 'on' : ''}`}>
      <button onClick={() => pick(t)} title={`Apply ${t.name}`}>
        <Preview t={t} slide={shown!} size={size} />
        <span className="theme-name">
          {t.name}
          <span className="theme-dots" aria-hidden>{[t.bg1, t.bg2, t.textColor].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        </span>
      </button>
      {t.custom && (
        <span className="theme-actions">
          <button title="Edit" onClick={() => { setStatus(''); setDraft(t) }}>Edit</button>
          <button title="Propose it for the built-in themes on GitHub" onClick={() => share(t)}>Submit</button>
          <button title="Delete" aria-label="Delete" onClick={async () => { if (await ask(`Delete the theme “${t.name}”?`)) { await deleteTheme(t.name); reload() } }}>×</button>
        </span>
      )}
    </div>
  )
  const own = themes.filter((t) => t.custom)

  return (
    <>
      <button onClick={() => { reload(); setDraft(null); setStatus(''); setShown(current); dialog.current!.showModal(); dialog.current!.focus() }}>Theme</button>
      <dialog ref={dialog} tabIndex={-1} className="tpl-dialog themes-dialog" onClose={() => setShown(null)} onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
        <header>
          <h2>{draft ? (own.some((t) => t.name === draft.name) ? 'Edit theme' : 'New theme') : 'Themes'}</h2>
          <button onClick={() => (draft ? setDraft(null) : dialog.current!.close())}>{draft ? 'Cancel' : 'Close'}</button>
        </header>
        {shown && (draft ? (
          <form className="theme-editor" onSubmit={(e) => { e.preventDefault(); save() }}>
            <Preview t={draft} slide={shown} size={size} />
            <div className="theme-fields">
              <label>Name<input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="My theme" /></label>
              <div className="swatches">
                {([['bg1', 'Top'], ['bg2', 'Bottom'], ['textColor', 'Text']] as const).map(([k, label]) => (
                  <label key={k} className="swatch">
                    <input type="color" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                    <span>{label}<small>{draft[k].toUpperCase()}</small></span>
                  </label>
                ))}
              </div>
              <label>
                <span className="angle">Gradient angle <small>{draft.angle}°</small></span>
                <input type="range" min={0} max={360} value={draft.angle} onChange={(e) => setDraft({ ...draft, angle: +e.target.value })} />
              </label>
              <button type="submit" className="primary" disabled={!draft.name.trim()}>Save theme</button>
              <p className="hint">Saving doesn't change your slides. Saving under an existing name of your own replaces it.</p>
            </div>
          </form>
        ) : (
          <div className="themes-body">
            <p className="hint">Click a theme to apply it to every slide on this platform. Only the colors change.</p>
            {status && <p className="status ok">{status}</p>}
            <h3>Your themes</h3>
            <div className={size[0] > size[1] ? 'theme-grid wide' : 'theme-grid'}>
              <button className="theme-card new" style={{ aspectRatio: `${size[0]} / ${size[1]}` }} onClick={() => { setStatus(''); setDraft({ name: '', bg1, bg2, angle, textColor }) }}>
                <span>+</span>New theme<small>from this slide</small>
              </button>
              {own.map(card)}
            </div>
            <h3>Built-in</h3>
            <div className={size[0] > size[1] ? 'theme-grid wide' : 'theme-grid'}>{themes.filter((t) => !t.custom).map(card)}</div>
          </div>
        ))}
      </dialog>
    </>
  )
}
