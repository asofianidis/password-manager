import { app } from 'electron'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import { join } from 'path'
import type { Settings, SettingsPatch, SyncPeer } from '../shared/types'
import { readFileIfExists, writeFileAtomic } from './fs-utils'

export const DEFAULT_SYNC_PORT = 47821

function defaults(): Settings {
  return {
    deviceId: randomUUID(),
    deviceName: hostname().replace(/\.local$/, ''),
    autoLockMinutes: 10,
    lockOnSuspend: true,
    clipboardClearSeconds: 30,
    oldPasswordDays: 365,
    generator: {
      mode: 'random',
      length: 20,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
      excludeAmbiguous: false,
      words: 5,
      separator: '-',
      capitalize: true,
      includeNumber: true
    },
    sync: {
      serverEnabled: false,
      bindAddress: '0.0.0.0',
      port: DEFAULT_SYNC_PORT,
      autoSyncMinutes: 0,
      peers: []
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Non-secret app settings, stored as plain JSON next to the vault. */
class SettingsStore {
  private settings: Settings | null = null
  private listeners = new Set<(settings: Settings) => void>()

  private get path(): string {
    return join(app.getPath('userData'), 'settings.json')
  }

  async load(): Promise<Settings> {
    if (this.settings) return this.settings
    const base = defaults()
    const raw = await readFileIfExists(this.path)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Settings>
      this.settings = {
        ...base,
        ...stored,
        generator: { ...base.generator, ...stored.generator },
        sync: { ...base.sync, ...stored.sync }
      }
    } else {
      this.settings = base
      await this.save()
    }
    return this.settings
  }

  get(): Settings {
    if (!this.settings) throw new Error('Settings not loaded')
    return this.settings
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const current = this.get()
    const next: Settings = {
      ...current,
      ...patch,
      deviceId: current.deviceId,
      generator: { ...current.generator, ...patch.generator },
      sync: { ...current.sync, ...patch.sync, peers: current.sync.peers }
    }
    next.autoLockMinutes = clamp(next.autoLockMinutes, 0, 24 * 60)
    next.clipboardClearSeconds = clamp(next.clipboardClearSeconds, 0, 600)
    next.oldPasswordDays = clamp(next.oldPasswordDays, 30, 3650)
    next.generator.length = clamp(next.generator.length, 4, 128)
    next.generator.words = clamp(next.generator.words, 3, 12)
    next.sync.port = clamp(next.sync.port, 1024, 65535)
    next.sync.autoSyncMinutes = clamp(next.sync.autoSyncMinutes, 0, 24 * 60)
    next.deviceName = next.deviceName.trim().slice(0, 64) || current.deviceName
    this.settings = next
    await this.save()
    return next
  }

  async setPeers(update: (peers: SyncPeer[]) => SyncPeer[]): Promise<Settings> {
    const current = this.get()
    this.settings = { ...current, sync: { ...current.sync, peers: update(current.sync.peers) } }
    await this.save()
    return this.settings
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify(this.settings, null, 2))
    for (const listener of this.listeners) listener(this.settings!)
  }
}

export const settingsStore = new SettingsStore()
