import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isDesktop } from './native'

// the desktop window is see-through glass; the editor paints over it, the launcher lets it show
if (isDesktop) document.documentElement.classList.add('glass')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
