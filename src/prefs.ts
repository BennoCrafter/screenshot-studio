// Preferences kept in localStorage and shared live between the parts of the app that show them.

import { useEffect, useState } from 'react'

// The agent's permission modes. Anything a mode doesn't allow on its own comes to the chat for Allow / Deny.
export const MODES = { manual: 'Ask every time', acceptEdits: 'Auto-accept edits', auto: 'Auto', bypassPermissions: 'Allow everything' }
export const MODELS = { '': 'Default model', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }
export const EFFORTS = { '': 'Default effort', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** A setting remembered between launches; every component using the same key sees a change at once. */
export function useStored<T extends string>(key: string, initial: T) {
  const read = () => { try { return (localStorage.getItem(key) as T | null) ?? initial } catch { return initial } }
  const [v, setV] = useState<T>(read)
  useEffect(() => {
    const sync = (e: Event) => (e as CustomEvent<string>).detail === key && setV(read())
    window.addEventListener('pref-changed', sync)
    return () => window.removeEventListener('pref-changed', sync)
  })
  const set = (next: T) => {
    try { localStorage.setItem(key, next) } catch { /* not remembered */ }
    setV(next)
    window.dispatchEvent(new CustomEvent('pref-changed', { detail: key }))
  }
  return [v, set] as const
}
