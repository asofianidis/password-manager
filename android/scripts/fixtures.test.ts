import { describe, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { matchLevel } from '../../src/main/browser/match'
import { pickNewer } from '../../src/shared/merge'
import type { VaultEntry } from '../../src/shared/types'

/**
 * Writes android/app/src/test/resources/interop.json from the desktop implementation, so the
 * Android unit tests check the phone against the real thing. Regenerate after changing the vault
 * format, the merge rule, or URL matching:
 *
 *   npx vitest run --config android/scripts/vitest.config.ts fixtures
 */
const OUT = join(__dirname, '../app/src/test/resources/interop.json')

const entry = (patch: Partial<VaultEntry>): VaultEntry => ({
  id: 'e1',
  title: 'GitHub',
  username: 'me@example.com',
  password: 'hunter2',
  url: 'https://github.com',
  notes: '',
  totp: '',
  folder: '',
  favorite: false,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  passwordUpdatedAt: 1700000000000,
  ...patch
})

describe('android interop fixtures', () => {
  it('writes them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-android-fixture-'))
    try {
      vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
      const { vault } = await import('../../src/main/vault/vault')
      await vault.init()
      await vault.create('first master password')
      await vault.createEntry({
        title: 'GitHub',
        username: 'me@example.com',
        password: 'hunter2',
        url: 'https://github.com',
        notes: 'line 1\nline "2"\t\\ é 🔑',
        totp: '',
        folder: 'Work',
        favorite: true
      })
      const deleted = await vault.createEntry({
        title: 'Old',
        username: 'x',
        password: 'y',
        url: '',
        notes: '',
        totp: '',
        folder: '',
        favorite: false
      })
      await vault.deleteEntry(deleted.id)
      // The vault as a phone that hasn't synced since the password change still has it
      const oldVault = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
      // Rotate so the header carries a retired key, as most real vaults will
      await vault.changeMasterPassword('first master password', 'second master password')
      const vaultFile = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))

      const tricky = [
        'plain',
        'quote " back \\ slash',
        'ctl \u0001\u001f\b\f\n\r\t',
        'é ü 中文 🔑',
        '\ud800 lone',
        'z'
      ]
      const canonical = tricky.map((notes) => {
        const e = entry({ notes })
        return { entry: e, json: JSON.stringify(e) }
      })
      const ties = tricky.flatMap((a, i) =>
        tricky.slice(i + 1).map((b) => {
          const x = entry({ notes: a })
          const y = entry({ notes: b })
          return { a: x, b: y, winner: pickNewer(x, y) === x ? 'a' : 'b' }
        })
      )

      const entryUrls = [
        'https://github.com',
        'github.com',
        'http://github.com',
        'https://www.github.com/login',
        'https://example.com:8443',
        'https://github.io',
        'https://me.github.io',
        'https://co.uk',
        'https://bbc.co.uk',
        'http://localhost:3000',
        'https://192.168.1.10',
        'androidapp://com.github.android',
        ''
      ]
      const pageUrls = [
        'https://github.com',
        'http://github.com',
        'https://gist.github.com',
        'https://evil-github.com',
        'https://example.com:8443',
        'https://example.com',
        'https://evil.github.io',
        'https://me.github.io',
        'https://news.bbc.co.uk',
        'https://evil.co.uk',
        'http://localhost:3000',
        'https://192.168.1.10',
        'https://www.github.com'
      ]
      const matches = entryUrls.flatMap((e) =>
        pageUrls.map((p) => ({ entryUrl: e, pageUrl: p, level: matchLevel(e, p) }))
      )

      writeFileSync(
        OUT,
        JSON.stringify(
          {
            password: 'second master password',
            oldPassword: 'first master password',
            vault: vaultFile,
            oldVault,
            canonical,
            ties,
            matches
          },
          null,
          2
        ) + '\n'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
