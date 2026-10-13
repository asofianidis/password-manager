import { describe, expect, it } from 'vitest'
import { randomBytes } from 'crypto'
import { AAD, DecryptionError, deriveKey, newKdfParams, open, seal } from '../src/main/vault/crypto'

describe('crypto', () => {
  it('seals and opens with matching AAD', () => {
    const key = randomBytes(32)
    const sealed = seal(key, 'secret', AAD.vaultData('v1'))
    expect(open(key, sealed, AAD.vaultData('v1')).toString()).toBe('secret')
  })

  it('rejects wrong key, wrong AAD, and tampering', () => {
    const key = randomBytes(32)
    const sealed = seal(key, 'secret', 'a')
    expect(() => open(randomBytes(32), sealed, 'a')).toThrow(DecryptionError)
    expect(() => open(key, sealed, 'b')).toThrow(DecryptionError)
    const raw = Buffer.from(sealed, 'base64')
    raw[15] ^= 1
    expect(() => open(key, raw.toString('base64'), 'a')).toThrow(DecryptionError)
  })

  it('derives a stable 32-byte key with Argon2id', async () => {
    const params = newKdfParams()
    const a = await deriveKey('correct horse', params)
    const b = await deriveKey('correct horse', params)
    const c = await deriveKey('wrong horse', params)
    expect(a).toHaveLength(32)
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
