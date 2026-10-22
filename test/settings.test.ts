import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

async function store(
  stored?: unknown
): Promise<typeof import('../src/main/settings').settingsStore> {
  const dir = mkdtempSync(join(tmpdir(), 'pm-settings-'))
  dirs.push(dir)
  if (stored) writeFileSync(join(dir, 'settings.json'), JSON.stringify(stored))
  vi.resetModules()
  vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
  const { settingsStore } = await import('../src/main/settings')
  await settingsStore.load()
  return settingsStore
}

describe('settings', () => {
  it('ignores a NaN patch instead of turning auto-lock off', async () => {
    const settings = await store()
    await settings.update({ autoLockMinutes: 5 })
    const next = await settings.update({ autoLockMinutes: NaN, sync: { port: Infinity } })
    expect(next.autoLockMinutes).toBe(5)
    expect(next.sync.port).toBe(47821)
  })

  it('repairs bad numbers in the stored file', async () => {
    // JSON.stringify turns NaN into null
    const settings = await store({ autoLockMinutes: null, clipboardClearSeconds: 'soon' })
    expect(settings.get().autoLockMinutes).toBe(10)
    expect(settings.get().clipboardClearSeconds).toBe(30)
  })
})
