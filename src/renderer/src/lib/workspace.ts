import { createStore } from './store'

/** Open editor tabs on the passwords page. `new` is the unsaved-entry tab. */
export const tabsStore = createStore<string[]>([])

export function openTab(id: string): void {
  tabsStore.set((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]))
}

/** Closes a tab and returns the tab that should become active, if the closed one was active. */
export function closeTab(id: string, activeId: string | undefined): string | undefined {
  const tabs = tabsStore.get()
  const index = tabs.indexOf(id)
  const next = tabs.filter((t) => t !== id)
  tabsStore.set(next)
  if (id !== activeId) return activeId
  return next[Math.min(index, next.length - 1)]
}

export function pruneTabs(validIds: Set<string>): void {
  const tabs = tabsStore.get()
  const next = tabs.filter((t) => t === 'new' || validIds.has(t))
  if (next.length !== tabs.length) tabsStore.set(next)
}

/** Command palette: closed, or open with an initial query (">" for commands). */
export const paletteStore = createStore<{ open: boolean; query: string }>({
  open: false,
  query: ''
})

export function openPalette(query = ''): void {
  paletteStore.set({ open: true, query })
}

export function closePalette(): void {
  paletteStore.set({ open: false, query: '' })
}

export interface LogLine {
  id: number
  at: number
  kind: 'cmd' | 'ok' | 'err' | 'info'
  text: string
}

/** Session-only output shown in the sync terminal panel. */
export const syncLogStore = createStore<LogLine[]>([])
let logId = 0

export function log(kind: LogLine['kind'], text: string): void {
  syncLogStore.set((lines) => [...lines.slice(-200), { id: ++logId, at: Date.now(), kind, text }])
}

/** Clears UI state that might reference decrypted data. */
export function resetWorkspace(): void {
  tabsStore.set([])
  closePalette()
}
