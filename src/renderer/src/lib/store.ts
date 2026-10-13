import { useSyncExternalStore } from 'react'

/** Minimal external store for small pieces of UI state shared across routes. */
export function createStore<T>(initial: T): {
  get: () => T
  set: (next: T | ((prev: T) => T)) => void
  use: () => T
} {
  let state = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    get: () => state,
    set: (next) => {
      state = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
      for (const listener of listeners) listener()
    },
    use: () => useSyncExternalStore(subscribe, () => state)
  }
}
