import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isDesktop } from './native'
import { applyAppearance } from './Settings'

// the desktop window is see-through glass; the editor paints over it, the launcher lets it show
// (macOS only: elsewhere the window has a normal title bar and no glass effect)
if (isDesktop && navigator.userAgent.includes('Mac')) document.documentElement.classList.add('glass')
applyAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
