import { app } from 'electron'
import { settingsStore } from './settings'
import { runsInBackground } from './tray'

/** Passed by the Windows login item so the app starts in the tray instead of opening its window */
const HIDDEN_ARG = '--hidden'

/**
 * Starting at login only makes sense where closing the window keeps the app running. Packaged
 * builds only: in dev this would register the bare Electron binary.
 */
const supported = runsInBackground && app.isPackaged

/** Whether this launch came from the login item, so the app should stay in the tray / menu bar. */
export function launchedAtLogin(): boolean {
  if (!supported) return false
  if (process.platform === 'darwin') return app.getLoginItemSettings().wasOpenedAtLogin === true
  return process.argv.includes(HIDDEN_ARG)
}

export function setOpenAtLogin(enabled: boolean): void {
  if (!supported) throw new Error('Opening at login is only available in installed builds')
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
}

/** The user can also remove the login item from the OS settings, so the OS is the source of truth. */
export async function syncOpenAtLogin(): Promise<void> {
  if (!supported) return
  const { openAtLogin } = app.getLoginItemSettings({ args: [HIDDEN_ARG] })
  if (openAtLogin !== settingsStore.get().openAtLogin) await settingsStore.update({ openAtLogin })
}
