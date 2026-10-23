import { describe, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { matchLevel } from '../../src/main/browser/match'
import { pickNewer } from '../../src/shared/merge'
import { composeEntry, sanitizeInput } from '../../src/shared/entries'
import type { EntryInput, VaultEntry } from '../../src/shared/types'

/**
 * Writes android/app/src/test/resources/interop.json from the desktop implementation, so the
 * Android and iOS unit tests check the apps against the real thing. Regenerate after changing the
 * vault format, the merge rule, or URL matching:
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

const blank: EntryInput = {
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  totp: '',
  folder: '',
  favorite: false
}
const CARD = {
  cardholder: 'Jane Doe',
  number: '4242424242424242',
  expiry: '08/27',
  cvv: '123',
  pin: ''
}
const IDENTITY = {
  kind: 'passport' as const,
  fullName: 'Jane Doe',
  number: 'X1234567',
  issuer: 'United States',
  issuedOn: '2020-01-31',
  expiresOn: '2030-01-30',
  birthDate: '1990-05-04'
}
const NOTE = 'Street: 1 Main St\nCity: Springfield'

/** One entry of each non-login type, built the way the desktop writes them. */
function typedEntries(text: string): VaultEntry[] {
  const meta = {
    id: 'e1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    passwordUpdatedAt: 1700000000000
  }
  const attachment = {
    id: 'a1b2c3d4-0000-4000-8000-000000000000',
    name: `scan ${text}.pdf`,
    mime: 'application/pdf',
    size: 1234,
    key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    createdAt: 1700000000001
  }
  return [
    composeEntry(
      meta,
      sanitizeInput({ ...blank, title: 'Card', type: 'card', card: { ...CARD, cardholder: text } })
    ),
    composeEntry(
      meta,
      sanitizeInput({
        ...blank,
        title: 'ID',
        type: 'identity',
        identity: { ...IDENTITY, issuer: text },
        attachments: [attachment]
      })
    ),
    composeEntry(meta, sanitizeInput({ ...blank, title: 'Note', type: 'note', notes: text })),
    composeEntry(
      meta,
      sanitizeInput({ ...blank, title: 'Doc', type: 'document', attachments: [attachment] })
    )
  ]
}

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

      // The other entry types, in a copy of the vault the phone checks separately
      const photo = await vault.addAttachment(
        'passport.jpg',
        'image/jpeg',
        Buffer.from('not really a jpeg é')
      )
      await vault.createEntry({ ...blank, title: 'Visa', type: 'card', card: CARD })
      const passport = await vault.createEntry({
        ...blank,
        title: 'Passport',
        type: 'identity',
        identity: IDENTITY,
        attachments: [photo]
      })
      await vault.createEntry({ ...blank, title: 'Address', type: 'note', notes: NOTE })
      const typedVault = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
      const attachment = {
        entryId: passport.id,
        id: photo.id,
        blob: readFileSync(join(dir, 'attachments', photo.id), 'utf8'),
        content: 'not really a jpeg é'
      }

      const tricky = [
        'plain',
        'quote " back \\ slash',
        'ctl \u0001\u001f\b\f\n\r\t',
        'é ü 中文 🔑',
        '\ud800 lone',
        'z'
      ]
      const typed = tricky.flatMap((notes) => typedEntries(notes))
      const canonical = [...tricky.map((notes) => entry({ notes })), ...typed].map((e) => ({
        entry: e,
        json: JSON.stringify(e)
      }))
      const ties = [
        ...tricky.flatMap((a, i) =>
          tricky.slice(i + 1).map((b) => [entry({ notes: a }), entry({ notes: b })])
        ),
        // A typed entry against a login, and typed entries against each other
        ...typed.map((t) => [entry({}), t]),
        ...typed.slice(1).map((t, i) => [typed[i], t])
      ].map(([x, y]) => ({ a: x, b: y, winner: pickNewer(x, y) === x ? 'a' : 'b' }))

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
            typedVault,
            attachment,
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
