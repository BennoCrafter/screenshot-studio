import { flushSync } from 'react-dom'

/** Runs a state change as an animated view transition, where the webview supports it. */
export function animate(change: () => void) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return change()
  document.startViewTransition(() => flushSync(change))
}
