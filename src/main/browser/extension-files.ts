import { app, net } from 'electron'
import { EventEmitter } from 'events'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, isAbsolute, join, normalize, sep } from 'path'
import { unzipSync } from 'fflate'
import {
  EXTENSION_CHANNEL_URL,
  RELEASE_DOWNLOAD_PREFIX,
  compareVersions,
  type ExtensionChannel
} from '../../shared/browser-protocol'
import type { ExtensionFilesStatus } from '../../shared/types'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

async function readVersion(dir: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

async function fetchOk(url: string): Promise<Response> {
  const response = await net.fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}

/** Writes a zip's files into `dir`, refusing entries that would land outside it. */
async function extractZip(zip: Uint8Array, dir: string): Promise<void> {
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    if (name.endsWith('/')) continue
    const relative = normalize(name)
    if (isAbsolute(relative) || relative.startsWith(`..${sep}`) || relative === '..') {
      throw new Error(`Unsafe path in extension zip: ${name}`)
    }
    const target = join(dir, relative)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, data)
  }
}

/**
 * Keeps the Chromium extension in a folder the app owns, which the user loads unpacked once.
 * Chrome won't update unpacked extensions itself, so the app refreshes the folder from the copy
 * bundled with each app release and from the extension-latest GitHub release; the extension then
 * reloads itself when it sees a newer version here (see BridgeStatus.extensionVersion).
 */
class ExtensionFiles extends EventEmitter<{ changed: [] }> {
  private state: ExtensionFilesStatus = { path: '', version: null, checking: false, error: null }
  private timer: NodeJS.Timeout | null = null

  get dir(): string {
    return join(app.getPath('userData'), 'browser-extension', 'chrome')
  }

  /** The copy shipped inside the app (see extraResources in electron-builder.yml) */
  private get bundledDir(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'browser-extension', 'chrome')
      : join(app.getAppPath(), 'extension', 'dist', 'chrome')
  }

  async start(): Promise<void> {
    if (this.timer) return
    this.state = { ...this.state, path: this.dir, version: await readVersion(this.dir) }
    try {
      const bundled = await readVersion(this.bundledDir)
      if (compareVersions(bundled, this.state.version) > 0) {
        await this.replace((next) => fs.cp(this.bundledDir, next, { recursive: true }))
      }
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) })
    }
    // Dev builds load the extension from extension/dist instead
    if (!app.isPackaged) return
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  status(): ExtensionFilesStatus {
    return this.state
  }

  /** Downloads the latest released extension if it's newer than the one in the folder. */
  async check(): Promise<ExtensionFilesStatus> {
    if (this.state.checking) return this.state
    this.set({ checking: true, error: null })
    try {
      const channel = (await (
        await fetchOk(`${EXTENSION_CHANNEL_URL}/extension.json`)
      ).json()) as ExtensionChannel
      if (typeof channel?.version !== 'string' || typeof channel.chrome?.url !== 'string') {
        throw new Error('Malformed extension.json')
      }
      if (compareVersions(channel.version, this.state.version) > 0) {
        if (!channel.chrome.url.startsWith(RELEASE_DOWNLOAD_PREFIX)) {
          throw new Error(`Refusing to download the extension from ${channel.chrome.url}`)
        }
        const zip = new Uint8Array(await (await fetchOk(channel.chrome.url)).arrayBuffer())
        const sha256 = createHash('sha256').update(zip).digest('hex')
        if (sha256 !== channel.chrome.sha256) throw new Error('Extension download is corrupt')
        await this.replace(async (next) => {
          await extractZip(zip, next)
          const version = await readVersion(next)
          if (version !== channel.version) {
            throw new Error(`Downloaded extension is ${version}, expected ${channel.version}`)
          }
        })
      }
      this.set({ checking: false })
    } catch (error) {
      this.set({ checking: false, error: error instanceof Error ? error.message : String(error) })
    }
    return this.state
  }

  /**
   * Fills a fresh folder, then swaps it in with renames so the browser never sees a
   * half-written extension.
   */
  private async replace(fill: (next: string) => Promise<void>): Promise<void> {
    const next = `${this.dir}.next`
    const old = `${this.dir}.old`
    await fs.rm(next, { recursive: true, force: true })
    await fs.mkdir(next, { recursive: true })
    try {
      await fill(next)
      const version = await readVersion(next)
      if (!version) throw new Error('Extension has no manifest version')
      await fs.rm(old, { recursive: true, force: true })
      await fs.rename(this.dir, old).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      await fs.rename(next, this.dir)
      await fs.rm(old, { recursive: true, force: true })
      this.set({ version, error: null })
      this.emit('changed')
    } finally {
      await fs.rm(next, { recursive: true, force: true })
    }
  }

  private set(patch: Partial<ExtensionFilesStatus>): void {
    this.state = { ...this.state, ...patch }
  }
}

export const extensionFiles = new ExtensionFiles()
