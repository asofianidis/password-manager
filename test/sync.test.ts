import { afterAll, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
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

    // Master password change on A rotates the key; B gets the new header but keeps working on the
    // old one until the new password is entered there
    const NEW_MASTER = 'a brand new master password'
    const oldKeyId = a.vault.keyId
    await a.vault.changeMasterPassword(MASTER, NEW_MASTER)
    expect(a.vault.keyId).not.toBe(oldKeyId)
    await b.vault.createEntry(input('made-before-switching', 'y'))
    const [changed] = await b.sync.syncAll(peerA.id)
    expect(changed).toMatchObject({ ok: false, error: expect.stringMatching(/changed on a/) })
    // A didn't take B's entries from the old-key request
    expect(a.vault.list().map((e) => e.title)).not.toContain('made-before-switching')
    expect(b.vault.status().pendingKeyChange).toBe(true)
    b.vault.lock()
    // The old password still opens B, so a header B can't use never locks it out
    await b.vault.unlock(MASTER)
    expect(b.vault.status().pendingKeyChange).toBe(true)
    b.vault.lock()
    // The new password adopts the new header, using the retired key to read B's local data
    await b.vault.unlock(NEW_MASTER)
    expect(b.vault.status().pendingKeyChange).toBe(false)
    expect(b.vault.keyId).toBe(a.vault.keyId)
    expect(b.vault.list()).toHaveLength(3)
    b.vault.lock()
    await expect(b.vault.unlock(MASTER)).rejects.toThrow(/Incorrect/)
    await b.vault.unlock(NEW_MASTER)
    const [after] = await b.sync.syncAll(peerA.id)
    expect(after).toMatchObject({ ok: true })
    expect(a.vault.list().map((e) => e.title)).toContain('made-before-switching')

    // A locked vault refuses to sync
    a.vault.lock()
    const [locked] = await b.sync.syncAll(peerA.id)
    expect(locked).toMatchObject({ ok: false, error: 'Vault is locked on that device' })

    await a.sync.stop()
    await b.sync.stop()
  })

  it('forwards a new key to a peer that is still on the old one', async () => {
    const MASTER = 'first master password'
    const a = await device('e', 47905)
    await a.vault.create(MASTER)
    await a.sync.reconcile()
    const b = await device('f', 47906)
    await b.sync.reconcile()
    const { code } = (await a.sync.startPairing()).pairing!
    const pairing = await b.sync.fetchPairing('127.0.0.1', 47905, code)
    await b.vault.join(pairing.vaultId, pairing.header, MASTER)
    const peerB = await a.sync.addPeer({ name: 'b', host: '127.0.0.1', port: 47906 })

    await a.vault.changeMasterPassword(MASTER, 'second master password')
    // A syncs to B: B can't read the new key, so A sends just the header under the old one
    const [pushed] = await a.sync.syncAll(peerB.id)
    expect(pushed).toMatchObject({ ok: false, error: expect.stringMatching(/old master password/) })
    expect(b.vault.status().pendingKeyChange).toBe(true)
    await b.vault.adoptPendingKey('second master password')
    expect(b.vault.keyId).toBe(a.vault.keyId)
    const [synced] = await a.sync.syncAll(peerB.id)
    expect(synced).toMatchObject({ ok: true })

    await a.sync.stop()
    await b.sync.stop()
  })

  it('cuts off devices on a revoked key until they pair again', async () => {
    const MASTER = 'first master password'
    const a = await device('g', 47907)
    await a.vault.create(MASTER)
    await a.vault.createEntry(input('secret', 's3cret'))
    await a.sync.reconcile()
    const b = await device('h', 47908)
    const { code } = (await a.sync.startPairing()).pairing!
    const pairing = await b.sync.fetchPairing('127.0.0.1', 47907, code)
    await b.vault.join(pairing.vaultId, pairing.header, MASTER)
    const peerA = await b.sync.addPeer({ name: 'a', host: '127.0.0.1', port: 47907 })
    await b.sync.syncAll(peerA.id)

    // A copy of the vault file taken before revoking (e.g. on the lost device)
    const stolen = JSON.parse(readFileSync(a.vault.path, 'utf8'))
    await a.vault.revokeOtherDevices(MASTER)
    await a.vault.createEntry(input('after', 'n3w'))

    // The old key can't read anything saved since, even with the master password
    const after = JSON.parse(readFileSync(a.vault.path, 'utf8'))
    const { deriveKey, open, AAD } = await import('../src/main/vault/crypto')
    const kek = await deriveKey(MASTER, stolen.key.kdf)
    const oldKey = open(kek, stolen.key.wrappedKey, AAD.vaultKey(stolen.vaultId))
    expect(() => open(oldKey, after.data, AAD.vaultData(after.vaultId))).toThrow()

    // B (on the old key) is refused and not sent the new header
    const [refused] = await b.sync.syncAll(peerA.id)
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/removed/) })
    expect(b.vault.status().pendingKeyChange).toBe(false)

    // Pairing again with a code from A brings B onto the new key, keeping its data
    const again = (await a.sync.startPairing()).pairing!
    const repair = await b.sync.fetchPairing('127.0.0.1', 47907, again.code)
    await b.vault.join(repair.vaultId, repair.header, MASTER)
    expect(b.vault.keyId).toBe(a.vault.keyId)
    const [ok] = await b.sync.syncAll(peerA.id)
    expect(ok).toMatchObject({ ok: true })
    expect(b.vault.list().map((e) => e.title)).toEqual(expect.arrayContaining(['secret', 'after']))

    await a.sync.stop()
    await b.sync.stop()
  })

  it('keeps a synced header pending so a bad one cannot lock the vault', async () => {
    const MASTER = 'first master password'
    const a = await device('i', 47909)
    await a.vault.create(MASTER)
    await a.vault.createEntry(input('kept', 'x'))
    const header = a.vault.keyHeader
    const bogus = { ...header, wrappedKey: randomBytes(60).toString('base64'), keyId: 'bogus' }

    // Weaker KDF settings are never accepted from a peer
    await a.vault.applyRemote([], {
      ...bogus,
      kdf: { ...header.kdf, memoryKiB: 19 * 1024, iterations: 2 },
      updatedAt: Date.now() + 1000
    })
    expect(a.vault.status().pendingKeyChange).toBe(false)

    // A well-formed header that no password opens is kept aside, not adopted
    await a.vault.applyRemote([], { ...bogus, updatedAt: Date.now() + 1000 })
    expect(a.vault.status().pendingKeyChange).toBe(true)
    expect(a.vault.keyHeader).toEqual(header)
    a.vault.lock()
    await a.vault.unlock(MASTER)
    expect(a.vault.list().map((e) => e.title)).toEqual(['kept'])
    await expect(a.vault.adoptPendingKey(MASTER)).rejects.toThrow(/Incorrect/)
    await a.vault.discardPendingKey()
    expect(a.vault.status().pendingKeyChange).toBe(false)
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
