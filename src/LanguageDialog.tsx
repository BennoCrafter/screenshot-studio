import { useState } from 'react'
import { LANGUAGES, languageName } from './project'

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
export function LanguageDialog({ dialog, have, onAdd }: {
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
