import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { EntryInput } from '../src/shared/types'

/**
 * Simulates two devices in one process: each gets its own module graph (and so its own vault,
 * settings, and sync singletons) backed by its own temp directory, talking over real HTTP.
 */
const dirs: string[] = []

type Device = {
  settingsStore: typeof import('../src/main/settings').settingsStore
  vault: typeof import('../src/main/vault/vault').vault
  sync: typeof import('../src/main/sync/sync').sync
}

async function device(name: string, port: number): Promise<Device> {
  const dir = mkdtempSync(join(tmpdir(), `pm-${name}-`))
  dirs.push(dir)
  vi.resetModules()
  vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
  const { settingsStore } = await import('../src/main/settings')
  const { vault } = await import('../src/main/vault/vault')
  const { sync } = await import('../src/main/sync/sync')
  await settingsStore.load()
  await settingsStore.update({
    deviceName: name,
    sync: { serverEnabled: true, bindAddress: '127.0.0.1', port }
  })
  await vault.init()
  return { settingsStore, vault, sync }
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const input = (title: string, password: string): EntryInput => ({
  title,
  password,
  username: 'me',
  url: `https://${title}.test`,
  notes: '',
  totp: '',
  folder: '',
  favorite: false
})

describe('peer-to-peer sync', () => {
  it('pairs a new device and syncs edits, deletions, and password changes both ways', async () => {
    const MASTER = 'correct horse battery staple'
    const a = await device('a', 47901)
    await a.vault.create(MASTER)
    await a.sync.reconcile()
    const github = await a.vault.createEntry(input('github', 'hunter2'))
    const gitlab = await a.vault.createEntry(input('gitlab', 'pw'))

    const b = await device('b', 47902)
    await b.sync.reconcile()

    // Pairing: wrong code is rejected, right code returns the key header
    const { code } = (await a.sync.startPairing()).pairing!
    await expect(
      b.sync.fetchPairing('127.0.0.1', 47901, '000000' === code ? '111111' : '000000')
    ).rejects.toThrow(/Incorrect pairing code/)
    const pairing = await b.sync.fetchPairing('127.0.0.1', 47901, code)
    await expect(b.vault.join(pairing.vaultId, pairing.header, 'wrong password!!')).rejects.toThrow(
      /Incorrect/
    )
    await b.vault.join(pairing.vaultId, pairing.header, MASTER)
    const peerA = await b.sync.addPeer({ name: 'a', host: '127.0.0.1', port: 47901 })

    // Initial pull
    const [first] = await b.sync.syncAll(peerA.id)
    expect(first).toMatchObject({ ok: true, received: 2 })
    expect(b.vault.get(github.id).password).toBe('hunter2')

    // B edits and deletes; A receives on next sync
    await b.vault.updateEntry(github.id, input('github', 'n3w-Str0ng-Passw0rd!'))
    await b.vault.deleteEntry(gitlab.id)
    await b.vault.createEntry(input('mobile-only', 'x'))
    await b.sync.syncAll(peerA.id)
    expect(a.vault.get(github.id).password).toBe('n3w-Str0ng-Passw0rd!')
    expect(() => a.vault.get(gitlab.id)).toThrow(/not found/)
    expect(
      a.vault
        .list()
        .map((e) => e.title)
        .sort()
    ).toEqual(['github', 'mobile-only'])

    // Master password change on A propagates to B
    await a.vault.changeMasterPassword(MASTER, 'a brand new master password')
    await b.sync.syncAll(peerA.id)
    b.vault.lock()
    await expect(b.vault.unlock(MASTER)).rejects.toThrow(/Incorrect/)
    await b.vault.unlock('a brand new master password')
    expect(b.vault.list()).toHaveLength(2)

    // A locked vault refuses to sync
    a.vault.lock()
    const [locked] = await b.sync.syncAll(peerA.id)
    expect(locked).toMatchObject({ ok: false, error: 'Vault is locked on that device' })

    await a.sync.stop()
    await b.sync.stop()
  })

  it('rejects devices that do not hold the vault key', async () => {
    const a = await device('c', 47903)
    await a.vault.create('first master password')
    await a.sync.reconcile()

    // An attacker with their own vault but the same vault id cannot read or write
    const evil = await device('d', 47904)
    await evil.vault.create('another master password')
    const res = await fetch('http://127.0.0.1:47903/v1/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vaultId: a.vault.vaultId,
        nonce: 'x'.repeat(24),
        payload: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      })
    })
    expect(res.status).toBe(401)
    await a.sync.stop()
  })
})
