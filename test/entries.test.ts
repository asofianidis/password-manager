import { describe, expect, it } from 'vitest'
import { cardBrand, composeEntry, entryDetail, sanitizeInput } from '../src/shared/entries'
import { duplicateKey, normalizeImported } from '../src/shared/importers'
import type { EntryInput } from '../src/shared/types'

const meta = { id: 'e1', createdAt: 1, updatedAt: 2, passwordUpdatedAt: 1 }
const base = {
  title: 'Item',
  username: '',
  password: '',
  url: '',
  notes: '',
  totp: '',
  folder: '',
  favorite: false
}

describe('composeEntry', () => {
  it('writes logins exactly as before, with no new keys', () => {
    const entry = composeEntry(meta, sanitizeInput({ ...base, password: 'pw' }))
    expect(Object.keys(entry)).toEqual([
      'id',
      'title',
      'username',
      'password',
      'url',
      'notes',
      'totp',
      'folder',
      'favorite',
      'createdAt',
      'updatedAt',
      'passwordUpdatedAt'
    ])
  })

  it('writes typed entries in the canonical key order and drops what does not apply', () => {
    const input = sanitizeInput({
      ...base,
      type: 'card',
      // Given in a scrambled order, as a careless caller might
      card: {
        pin: '',
        cvv: '123',
        expiry: '08/27',
        number: '4242 4242-4242 4242',
        cardholder: ' Jo '
      },
      identity: { kind: 'passport', fullName: 'ignored' } as never,
      attachments: [
        { createdAt: 5, key: 'k', size: 3, mime: 'image/png', name: 'a.png', id: 'att-0001' },
        { id: '../evil', name: 'x', mime: '', size: 0, key: 'k', createdAt: 0 },
        { id: 'att-0001', name: 'dupe', mime: '', size: 0, key: 'k', createdAt: 0 }
      ]
    })
    const entry = composeEntry(meta, input)
    expect(JSON.stringify(entry)).toBe(
      '{"id":"e1","title":"Item","username":"","password":"","url":"","notes":"","totp":"",' +
        '"folder":"","favorite":false,"createdAt":1,"updatedAt":2,"passwordUpdatedAt":1,' +
        '"type":"card","card":{"cardholder":"Jo","number":"4242424242424242","expiry":"08/27",' +
        '"cvv":"123","pin":""},"attachments":[{"id":"att-0001","name":"a.png",' +
        '"mime":"image/png","size":3,"key":"k","createdAt":5}]}'
    )
  })

  it('falls back to a login for an unknown type and an unknown ID kind to "other"', () => {
    expect(sanitizeInput({ ...base, type: 'bogus' as never }).type).toBe('login')
    expect(sanitizeInput({ ...base, identity: { kind: 'x' } as never }).identity.kind).toBe('other')
  })
})

describe('entry helpers', () => {
  it('names card networks and shows only the last digits', () => {
    expect(cardBrand('4111111111111111')).toBe('Visa')
    expect(cardBrand('5555555555554444')).toBe('Mastercard')
    expect(cardBrand('2221000000000009')).toBe('Mastercard')
    expect(cardBrand('378282246310005')).toBe('American Express')
    expect(cardBrand('9999')).toBeNull()
    const card = composeEntry(
      meta,
      sanitizeInput({ ...base, type: 'card', card: { number: '4111111111111111' } as never })
    )
    expect(entryDetail(card)).toBe('Visa •••• 1111')
  })

  it('tells typed entries apart when looking for duplicates, and keeps their fields on import', () => {
    const card = (number: string): EntryInput => ({
      ...base,
      type: 'card',
      card: { cardholder: '', number, expiry: '', cvv: '', pin: '' }
    })
    expect(duplicateKey(card('1111'))).not.toBe(duplicateKey(card('2222')))
    expect(duplicateKey(card('1111'))).toBe(duplicateKey(card('1111')))

    const imported = normalizeImported({
      ...card('4242'),
      attachments: [{ name: 'a.txt', mime: 'text/plain', data: 'aGk=' }]
    })
    expect(imported).toMatchObject({
      type: 'card',
      card: { number: '4242' },
      files: [{ name: 'a.txt', mime: 'text/plain', data: 'aGk=' }]
    })
  })
})
