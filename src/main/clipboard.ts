import { clipboard } from 'electron'
import { settingsStore } from './settings'

let lastSecret: string | null = null
let clearTimer: NodeJS.Timeout | null = null

/** Copies a secret and clears it later, but only if the clipboard still holds what we put there. */
export function copySecret(text: string): void {
  clipboard.writeText(text)
  lastSecret = text
  if (clearTimer) clearTimeout(clearTimer)
  const seconds = settingsStore.get().clipboardClearSeconds
  if (seconds > 0) clearTimer = setTimeout(clearSecret, seconds * 1000)
}

export function clearSecret(): void {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = null
  if (lastSecret !== null && clipboard.readText() === lastSecret) clipboard.clear()
  lastSecret = null
}
