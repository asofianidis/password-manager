import { EventEmitter } from 'events'
import { app, autoUpdater as nativeUpdater, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

const RELEASES_URL = 'https://github.com/asofianidis/password-manager/releases'
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/** How long the app gets to shut down cleanly before an update kills it */
const FORCE_EXIT_MS = 1500

/**
 * Checks GitHub releases for a newer version. Windows and Linux download and install in place.
 * macOS only installs signed builds (Squirrel.Mac), so there the update opens the release page.
 */
class Updater extends EventEmitter {
  private state: UpdateStatus = { state: 'idle', version: null, progress: null, error: null }
  private readonly canInstall = process.platform !== 'darwin'
  private timer: NodeJS.Timeout | null = null

  start(): void {
    // Packaged builds only: dev runs have no app-update.yml to read
    if (!app.isPackaged || this.timer) return

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) =>
      this.set({ state: 'available', version: info.version, error: null })
    )
    autoUpdater.on('download-progress', (p) =>
      this.set({ state: 'downloading', progress: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ state: 'ready', version: info.version, progress: null })
    )
    autoUpdater.on('error', (error) => {
      // A failed background check shouldn't put a button on screen; a failed download should
      if (this.state.state !== 'downloading') return
      this.set({ state: 'available', progress: null, error: error.message })
    })

    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  status(): UpdateStatus {
    return this.state
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) throw new Error('Updates are only available in packaged builds')
    // Don't restart a check or download that's already under way
    if (this.state.state === 'idle') await autoUpdater.checkForUpdates().catch(() => null)
    return this.state
  }

  /** Downloads the update, or installs it if already downloaded. */
  async install(): Promise<void> {
    if (!this.canInstall) {
      if (this.state.version) await shell.openExternal(`${RELEASES_URL}/tag/v${this.state.version}`)
      return
    }
    if (this.state.state === 'ready') {
      // Only emitted once the installer has started, so a failed install doesn't kill the app
      nativeUpdater.once('before-quit-for-update', () => {
        // The installer can't replace files the old version still has open. Nothing may keep it
        // running (the tray, a pending dialog, sync shutting down), so force it out
        setTimeout(() => app.exit(0), FORCE_EXIT_MS)
      })
      // Defer so the IPC reply goes out before the app quits. Silent: no installer wizard, and
      // the new version opens once it's installed
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
    } else if (this.state.state === 'available') {
      this.set({ state: 'downloading', progress: 0, error: null })
      await autoUpdater.downloadUpdate()
    }
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.state = { ...this.state, ...patch }
    this.emit('status', this.state)
  }
}

export const updater = new Updater()
