import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function toast(message: string, tone: Toast['tone'] = 'success'): void {
  const id = nextId++
  toasts = [...toasts, { id, message, tone }]
  emit()
  setTimeout(() => dismissToast(id), tone === 'error' ? 6000 : 3000)
}

export function toastError(error: unknown): void {
  toast(error instanceof Error ? error.message : String(error), 'error')
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts
  )
}
