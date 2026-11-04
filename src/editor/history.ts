// Undo and redo for the open project: a burst of changes (one drag, a few words typed) is one step.

import { useRef, useState } from 'react'
import type { Project } from '../model/project'

export type Updater<T> = (fn: (v: T) => T) => void

/** Wraps `commit` so changes are recorded; `undo` and `redo` step through them. */
export function useHistory(project: Project, commit: Updater<Project>) {
  const [past, setPast] = useState<Project[]>([])
  const [future, setFuture] = useState<Project[]>([])
  const burst = useRef<ReturnType<typeof setTimeout>>(undefined) // set while changes keep coming within 500 ms
  const endBurst = () => {
    clearTimeout(burst.current)
    burst.current = undefined
  }
  const setProject: Updater<Project> = (fn) => {
    if (!burst.current) {
      setPast((p) => [...p.slice(-99), project])
      setFuture([])
    }
    clearTimeout(burst.current)
    burst.current = setTimeout(endBurst, 500)
    commit(fn)
  }
  const travel = (from: Project[], setFrom: typeof setPast, setTo: typeof setPast) => {
    const p = from.at(-1)
    if (!p) return
    setFrom(from.slice(0, -1))
    setTo((to) => [...to, project])
    endBurst()
    commit(() => p)
  }
  return {
    setProject,
    undo: () => travel(past, setPast, setFuture),
    redo: () => travel(future, setFuture, setPast),
    canUndo: past.length > 0,
  }
}
