import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isDesktop, typing } from './lib/native'
import { applyAppearance, applyMcpAccess } from './settings/prefs'

// the desktop window is see-through glass; the editor paints over it, the launcher lets it show
// (macOS only: elsewhere the window has a normal title bar and no glass effect)
if (isDesktop && navigator.userAgent.includes('Mac')) document.documentElement.classList.add('glass')
applyAppearance()
applyMcpAccess()

// Esc leaves a text field, unless the field already used it (clearing a search); in a dialog, the next Esc closes it
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented && typing(e.target)) { e.preventDefault(); (e.target as HTMLElement).blur() }
})

// ⌘F / Ctrl+F jumps to the search field of the open dialog (template chooser, settings)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'f' || !(e.metaKey || e.ctrlKey)) return
  const field = [...document.querySelectorAll<HTMLInputElement>('dialog[open] input[type=search]')].pop()
  if (field) { e.preventDefault(); field.select() }
})

// on desktop, warnings, errors and crashes also go to the app's log file (see tauri-plugin-log in lib.rs)
if (isDesktop) import('@tauri-apps/plugin-log').then(({ warn, error }) => {
  const text = (args: unknown[]) => args.map((a) => a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  const { warn: cw, error: ce } = console
  console.warn = (...a) => { cw(...a); warn(text(a)).catch(() => {}) }
  console.error = (...a) => { ce(...a); error(text(a)).catch(() => {}) }
  window.addEventListener('error', (e) => console.error('uncaught', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => console.error('unhandled rejection', e.reason))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
