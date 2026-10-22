import { app, Menu, nativeImage, Tray } from 'electron'
import icon from '../../resources/icon.png?asset'
import trayTemplate from '../../resources/trayTemplate.png?asset'
import { vault } from './vault/vault'

/**
 * Closing the window on Windows and macOS keeps the app running in the system tray / menu bar,
 * so the browser extension can still fill logins. Linux trays are unreliable (GNOME has none), so
 * there closing the window still quits.
 */
export const runsInBackground = process.platform === 'win32' || process.platform === 'darwin'

let tray: Tray | null = null

function trayImage(): Electron.NativeImage {
  // macOS: a template image (trayTemplate@2x.png is picked up alongside) that adapts to the menu bar
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(trayTemplate)
    image.setTemplateImage(true)
    return image
  }
  const source = nativeImage.createFromPath(icon)
  const image = nativeImage.createEmpty()
  for (const scaleFactor of [1, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor)
    image.addRepresentation({
      scaleFactor,
      buffer: source.resize({ width: size, height: size, quality: 'best' }).toPNG()
    })
  }
  return image
}

export function createTray(showWindow: () => void): void {
  if (!runsInBackground || tray) return
  tray = new Tray(trayImage())
  tray.setToolTip(app.getName())

  const updateMenu = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${app.getName()}`, click: showWindow },
        { label: 'Lock Vault', enabled: vault.isUnlocked, click: () => vault.lock() },
        { type: 'separator' },
        { label: `Quit ${app.getName()}`, role: 'quit' }
      ])
    )
  }
  updateMenu()
  vault.on('locked', updateMenu)
  vault.on('unlocked', updateMenu)

  // Windows opens the app on a left click and shows the menu on a right click; macOS shows the
  // menu on any click, like other menu bar items
  if (process.platform === 'win32') tray.on('click', showWindow)
}

let notified = false

/** Tells Windows users, once per run, that closing the window didn't quit the app. */
export function notifyRunningInTray(): void {
  if (process.platform !== 'win32' || !tray || notified) return
  notified = true
  tray.displayBalloon({
    iconType: 'info',
    title: `${app.getName()} is still running`,
    content:
      'It stays in the system tray so your browser can keep filling logins. ' +
      'Right-click the tray icon to quit.'
  })
}
