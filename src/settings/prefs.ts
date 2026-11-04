// Preferences kept in localStorage and shared live between the parts of the app that show them.

import { useEffect, useState } from 'react'
import { isDesktop } from '../lib/native'

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

/** Light, dark, or following the system; picked in Settings. */
export type Appearance = 'system' | 'light' | 'dark'
export const storedAppearance = (): Appearance => {
  try { return (localStorage.getItem('appearance') as Appearance) || 'system' } catch { return 'system' }
}

/** Light or dark regardless of the system; on the desktop the window glass follows too. */
export async function applyAppearance(a = storedAppearance()) {
  if (a === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = a
  if (isDesktop) await (await import('@tauri-apps/api/window')).getCurrentWindow().setTheme(a === 'system' ? null : a).catch(() => {})
}

/** Whether other MCP clients (terminal agents, editors) may use the app's MCP server (the app's own chat always can). */
export const storedOthers = () => {
  try { return localStorage.getItem('mcp-others') !== 'off' } catch { return true }
}
export async function applyMcpAccess(on = storedOthers()) {
  if (isDesktop) await (await import('@tauri-apps/api/core')).invoke('mcp_allow_others', { on }).catch(() => {})
}

/** Opens Settings, at `section` if given (e.g. 'agent'). */
export const openSettings = (section?: string) => window.dispatchEvent(new CustomEvent('open-settings', { detail: section }))

/** A panel width, remembered between launches. */
export function useWidth(key: string, initial: number) {
  const [w, setW] = useStored(key, String(initial))
  return [Number(w) || initial, (px: number) => setW(String(px))] as const
}

// desktop: settings.json in the app data folder, next to projects/; browser: localStorage
const CONFIG = 'settings.json'
async function readConfig(): Promise<Record<string, unknown>> {
  try {
    if (!isDesktop) return JSON.parse(localStorage.getItem(`screenshot-studio:${CONFIG}`) ?? '{}')
    const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs')
    const opt = { baseDir: BaseDirectory.AppData }
    return (await exists(CONFIG, opt)) ? JSON.parse(await readTextFile(CONFIG, opt)) : {}
  } catch { return {} }
}
/** A value from the settings file. */
export const getConfig = async <T,>(key: string) => (await readConfig())[key] as T | undefined
/** Sets a value in the settings file; listeners of 'config-changed' hear about it. */
export async function setConfig(key: string, value: unknown) {
  const text = JSON.stringify({ ...(await readConfig()), [key]: value }, null, 2)
  try {
    if (!isDesktop) localStorage.setItem(`screenshot-studio:${CONFIG}`, text)
    else {
      const { BaseDirectory, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const opt = { baseDir: BaseDirectory.AppData }
      await mkdir('', { ...opt, recursive: true })
      await writeTextFile(CONFIG, text, opt)
    }
  } catch { /* not remembered */ }
  window.dispatchEvent(new CustomEvent('config-changed', { detail: key }))
}
