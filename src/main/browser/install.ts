import { app } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { homedir, tmpdir, userInfo } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import {
  CHROME_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
  NATIVE_HOST_NAME
} from '../../shared/browser-protocol'

type Kind = 'chromium' | 'firefox'

interface Target {
  browser: string
  kind: Kind
  /** Only register if this exists, i.e. the browser has been run on this machine */
  ifExists: string
  /** Folder the host manifest goes in */
  dir: string
}

/** Unix socket paths are limited to ~104 bytes; fall back to a short path if the default is long */
export function bridgeSocketPath(): string {
  if (process.platform === 'win32') {
    const id = createHash('sha256')
      .update(`${userInfo().username}:${app.getPath('userData')}`)
      .digest('hex')
      .slice(0, 16)
    return `\\\\.\\pipe\\password-manager-browser-${id}`
  }
  const path = join(app.getPath('userData'), 'browser.sock')
  return Buffer.byteLength(path) < 100
    ? path
    : join(tmpdir(), `pm-browser-${process.getuid?.()}.sock`)
}

function unixTargets(): Target[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    const chromium = (browser: string, ...path: string[]): Target => ({
      browser,
      kind: 'chromium',
      ifExists: join(support, ...path),
      dir: join(support, ...path, 'NativeMessagingHosts')
    })
    return [
      chromium('Chrome', 'Google', 'Chrome'),
      chromium('Chromium', 'Chromium'),
      chromium('Edge', 'Microsoft Edge'),
      chromium('Brave', 'BraveSoftware', 'Brave-Browser'),
      chromium('Vivaldi', 'Vivaldi'),
      chromium('Arc', 'Arc', 'User Data'),
      {
        browser: 'Firefox',
        kind: 'firefox',
        ifExists: join(support, 'Firefox'),
        dir: join(support, 'Mozilla', 'NativeMessagingHosts')
      }
    ]
  }
  const config = process.env['XDG_CONFIG_HOME'] || join(home, '.config')
  const chromium = (browser: string, ...path: string[]): Target => ({
    browser,
    kind: 'chromium',
    ifExists: join(config, ...path),
    dir: join(config, ...path, 'NativeMessagingHosts')
  })
  return [
    chromium('Chrome', 'google-chrome'),
    chromium('Chromium', 'chromium'),
    chromium('Edge', 'microsoft-edge'),
    chromium('Brave', 'BraveSoftware', 'Brave-Browser'),
    chromium('Vivaldi', 'vivaldi'),
    {
      browser: 'Firefox',
      kind: 'firefox',
      ifExists: join(home, '.mozilla'),
      dir: join(home, '.mozilla', 'native-messaging-hosts')
    }
  ]
}

/** Windows browsers find hosts through these registry keys (under HKCU) instead of folders */
const WINDOWS_TARGETS: { browser: string; kind: Kind; key: string }[] = [
  { browser: 'Chrome', kind: 'chromium', key: 'Software\\Google\\Chrome' },
  { browser: 'Chromium', kind: 'chromium', key: 'Software\\Chromium' },
  { browser: 'Edge', kind: 'chromium', key: 'Software\\Microsoft\\Edge' },
  { browser: 'Brave', kind: 'chromium', key: 'Software\\BraveSoftware\\Brave-Browser' },
  { browser: 'Firefox', kind: 'firefox', key: 'Software\\Mozilla' }
]

const exists = (path: string): Promise<boolean> =>
  fs.access(path).then(
    () => true,
    () => false
  )

/**
 * The binary that runs the host in Node mode. A Linux AppImage mounts at a new temporary path
 * each launch, so point at the AppImage itself, which still works after the app quits.
 */
const runtimeBinary = (): string => process.env['APPIMAGE'] || process.execPath

/** What the host launches when the app isn't running. Unset in dev, where there's no app to open. */
function appLauncher(): string | null {
  if (!app.isPackaged) return null
  if (process.platform === 'darwin')
    return process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '')
  return runtimeBinary()
}

const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

async function writeWrapper(dir: string, socketPath: string): Promise<string> {
  // Bundled next to the main process entry (see electron.vite.config.ts)
  const script = join(__dirname, 'native-host.js')
  const launcher = appLauncher()
  if (process.platform === 'win32') {
    const path = join(dir, 'host.bat')
    const lines = [
      '@echo off',
      'set ELECTRON_RUN_AS_NODE=1',
      `set "PM_SOCKET=${socketPath}"`,
      launcher ? `set "PM_APP=${launcher}"` : '',
      `"${runtimeBinary()}" "${script}" %*`
    ]
    await fs.writeFile(path, lines.filter(Boolean).join('\r\n') + '\r\n')
    return path
  }
  const path = join(dir, 'host.sh')
  const lines = [
    '#!/bin/sh',
    'export ELECTRON_RUN_AS_NODE=1',
    `export PM_SOCKET=${shQuote(socketPath)}`,
    launcher ? `export PM_APP=${shQuote(launcher)}` : '',
    `exec ${shQuote(runtimeBinary())} ${shQuote(script)} "$@"`
  ]
  await fs.writeFile(path, lines.filter(Boolean).join('\n') + '\n', { mode: 0o755 })
  await fs.chmod(path, 0o755)
  return path
}

function manifest(kind: Kind, wrapper: string): string {
  const base = {
    name: NATIVE_HOST_NAME,
    description: 'Password Manager browser bridge',
    path: wrapper,
    type: 'stdio'
  }
  return JSON.stringify(
    kind === 'chromium'
      ? { ...base, allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`] }
      : { ...base, allowed_extensions: [FIREFOX_EXTENSION_ID] },
    null,
    2
  )
}

/**
 * Writes the host wrapper and registers it with every browser found. Runs on each launch so the
 * paths stay current when the app moves or updates. Returns the browsers it registered with.
 */
export async function registerNativeHost(socketPath: string): Promise<string[]> {
  const dir = join(app.getPath('userData'), 'native-host')
  await fs.mkdir(dir, { recursive: true })
  const wrapper = await writeWrapper(dir, socketPath)
  const manifests: Record<Kind, string> = {
    chromium: join(dir, `${NATIVE_HOST_NAME}.chromium.json`),
    firefox: join(dir, `${NATIVE_HOST_NAME}.firefox.json`)
  }
  for (const kind of ['chromium', 'firefox'] as const) {
    await fs.writeFile(manifests[kind], manifest(kind, wrapper))
  }

  const registered: string[] = []
  if (process.platform === 'win32') {
    const reg = promisify(execFile)
    for (const target of WINDOWS_TARGETS) {
      const key = `HKCU\\${target.key}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`
      try {
        await reg('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifests[target.kind], '/f'])
        registered.push(target.browser)
      } catch {
        // Registration for one browser failing shouldn't stop the others
      }
    }
    return registered
  }

  for (const target of unixTargets()) {
    if (!(await exists(target.ifExists))) continue
    try {
      await fs.mkdir(target.dir, { recursive: true })
      await fs.writeFile(
        join(target.dir, `${NATIVE_HOST_NAME}.json`),
        manifest(target.kind, wrapper)
      )
      registered.push(target.browser)
    } catch {
      // Registration for one browser failing shouldn't stop the others
    }
  }
  return registered
}
