import { createStore } from './store'

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
  closePalette()
}
