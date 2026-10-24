import { clipboard } from 'electron'
import { settingsStore } from './settings'

let lastSecret: string | null = null
let clearTimer: NodeJS.Timeout | null = null

/** Copies a secret and clears it later, but only if the clipboard still holds what we put there. */
export async function copySecret(text: string): Promise<void> {
  await clipboard.writeText(text)
  lastSecret = text
  if (clearTimer) clearTimeout(clearTimer)
  const seconds = settingsStore.get().clipboardClearSeconds
  if (seconds > 0) clearTimer = setTimeout(() => void clearSecret(), seconds * 1000)
}

export async function clearSecret(): Promise<void> {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = null
  const secret = lastSecret
  lastSecret = null
  if (secret === null) return
  // A secret copied while this reads the clipboard is newer, doesn't match, and stays
  const current = await clipboard.readText().catch(() => null)
  if (current === secret) clipboard.clear()
}
