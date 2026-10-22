import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc, wireEvents } from './ipc'
import { vault } from './vault/vault'
import { settingsStore } from './settings'
import { sync } from './sync/sync'
import { startAutoLock } from './auto-lock'
import { updater } from './updater'
import { browserBridge } from './browser'
import { createTray, notifyRunningInTray, runsInBackground } from './tray'
import { launchedAtLogin, syncOpenAtLogin } from './login-item'

let mainWindow: BrowserWindow | null = null
/** Set once the app is really quitting, so closing the window stops hiding it */
let quitting = false

function createWindow({ hidden = false } = {}): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0b0a',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!hidden) mainWindow?.show()
  })

  // Keep running in the tray / menu bar so the browser extension can still fill logins
  mainWindow.on('close', (event) => {
    if (quitting || !runsInBackground) return
    event.preventDefault()
    mainWindow?.hide()
    // Live in the menu bar only, until the window is opened again
    if (process.platform === 'darwin') app.dock?.hide()
    notifyRunningInTray()
  })
  // Windows shutdown / sign-out doesn't emit before-quit; don't let the hidden window block it
  mainWindow.on('query-session-end', () => {
    quitting = true
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open external links in the browser; never navigate the app window away from the app
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Brings the window to the front, recreating it if it was closed. */
function showWindow(): BrowserWindow {
  if (process.platform === 'darwin') void app.dock?.show()
  if (!mainWindow) createWindow()
  const window = mainWindow!
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
  return window
}

// Two instances writing the same vault file would corrupt it
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Launching the app again (e.g. from the Start menu) opens the window hidden in the tray
  app.on('second-instance', () => {
    showWindow()
  })

  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.password-manager')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await settingsStore.load()
    await syncOpenAtLogin()
    await vault.init()

    registerIpc((event) => event.sender === mainWindow?.webContents)
    wireEvents()
    startAutoLock()
    await sync.reconcile()

    // Started at login: stay in the tray / menu bar until the user opens the window
    const hidden = launchedAtLogin()
    if (hidden && process.platform === 'darwin') app.dock?.hide()
    createWindow({ hidden })
    createTray(() => void showWindow())
    updater.start()
    void browserBridge.start(showWindow)

    // macOS: clicking the dock icon or opening the app from Finder while it runs in the menu bar
    app.on('activate', () => {
      showWindow()
    })
  })

  app.on('before-quit', () => {
    quitting = true
    vault.lock()
    void sync.stop()
    void browserBridge.stop()
  })
}

// Only reached where closing the window doesn't hide it to the tray (Linux)
app.on('window-all-closed', () => {
  if (!runsInBackground) app.quit()
})
