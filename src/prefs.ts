// Preferences kept in localStorage and shared live between the parts of the app that show them.

import { useEffect, useState } from 'react'

// The agent's permission modes. Anything a mode doesn't allow on its own comes to the chat for Allow / Deny.
export const MODES = { manual: 'Ask every time', acceptEdits: 'Auto-accept edits', auto: 'Auto', bypassPermissions: 'Allow everything' }

/** A model as the installed Claude Code lists it. */
interface AgentModel { value: string; displayName: string; description: string; supportedEffortLevels?: string[] }
let models: Promise<AgentModel[]> | undefined
/** Claude Code's models, asked once per launch; empty until they arrive or if it isn't installed. */
export function useModels() {
  const [list, setList] = useState<AgentModel[]>([])
  useEffect(() => {
    models ??= import('@tauri-apps/api/core').then(({ invoke }) => invoke<AgentModel[]>('agent_models'))
    models.then(setList, (e) => console.warn('agent models not loaded', e))
  }, [])
  return list
}
/** The model picked ('' or 'default' is Claude Code's default), and the effort levels it offers. */
export const modelOf = (list: AgentModel[], value: string) => list.find((m) => m.value === (value || 'default'))
/** 'xhigh' → 'Extra high', 'low' → 'Low'; '' is the model's own default. */
export const effortName = (e: string) => !e ? 'Default effort' : e === 'xhigh' ? 'Extra high' : e[0].toUpperCase() + e.slice(1)

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
