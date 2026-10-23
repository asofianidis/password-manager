import { describe, expect, it } from 'vitest'
import {
  conceptFromAutocomplete,
  conceptFromText,
  expandFields,
  fillableFields,
  formatForControl,
  matchFields,
  parseNoteFields,
  splitExpiry,
  type FillField
} from '../src/shared/fill'
import type { VaultEntry } from '../src/shared/types'

const entry = (extra: Partial<VaultEntry>): VaultEntry => ({
  id: 'e1',
  title: 'Item',
  username: '',
  password: '',
  url: '',
  notes: '',
  totp: '',
  folder: '',
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
  passwordUpdatedAt: 0,
  ...extra
})

describe('parseNoteFields', () => {
  it('reads "Label: value" lines and skips URLs and everything else', () => {
    const notes = [
      'My home address',
      'Street: 1 Main St',
      '  City :  Springfield  ',
      'https://example.com/login',
      'Website: https://example.com',
      '12: thirty',
      'Empty:',
      'Time: 10:30'
    ].join('\n')
    expect(parseNoteFields(notes)).toEqual([
      { label: 'Street', value: '1 Main St' },
      { label: 'City', value: 'Springfield' },
      { label: 'Website', value: 'https://example.com' },
      { label: 'Time', value: '10:30' }
    ])
  })
})

describe('concepts', () => {
  it('recognizes labels and field names in different spellings', () => {
    expect(conceptFromText('Postal code')).toBe('postal-code')
    expect(conceptFromText('billing_zipCode')).toBe('postal-code')
    expect(conceptFromText('Email address')).toBe('email')
    expect(conceptFromText('Address line 2')).toBe('address-line2')
    expect(conceptFromText('street')).toBe('address-line1')
    expect(conceptFromText('firstName')).toBe('given-name')
    expect(conceptFromText('Name on card')).toBe('cc-name')
    expect(conceptFromText('cardNumber')).toBe('cc-number')
    expect(conceptFromText('exp-month')).toBe('cc-exp-month')
    expect(conceptFromText('CVC')).toBe('cc-csc')
    expect(conceptFromText('username')).toBe('username')
    expect(conceptFromText('Full name')).toBe('name')
    expect(conceptFromText('Favorite color')).toBeNull()
  })

  it('reads autocomplete attributes with section and shipping tokens', () => {
    expect(conceptFromAutocomplete('shipping postal-code')).toBe('postal-code')
    expect(conceptFromAutocomplete('section-a billing cc-number')).toBe('cc-number')
    expect(conceptFromAutocomplete('off')).toBeNull()
  })
})

describe('fillableFields', () => {
  it('offers card fields but never the PIN, plus labelled lines from its notes', () => {
    const card = entry({
      type: 'card',
      card: { cardholder: 'Jane Doe', number: '4242', expiry: '08/27', cvv: '123', pin: '9999' },
      notes: 'Billing zip: 90210'
    })
    const fields = fillableFields(card)
    expect(fields.map((f) => [f.label, f.concept])).toEqual([
      ['Cardholder name', 'cc-name'],
      ['Card number', 'cc-number'],
      ['Expiry', 'cc-exp'],
      ['Security code', 'cc-csc'],
      ['Billing zip', 'postal-code']
    ])
    expect(fields.some((f) => f.value === '9999')).toBe(false)
  })

  it('offers a whole note when it has no labelled lines, and nothing for logins', () => {
    expect(fillableFields(entry({ type: 'note', notes: ' just text ' }))).toEqual([
      { label: 'Note text', value: 'just text', concept: null }
    ])
    expect(fillableFields(entry({ password: 'x', notes: 'Street: 1 Main St' }))).toEqual([])
  })
})

describe('matching', () => {
  const field = (label: string, value: string): FillField => ({
    label,
    value,
    concept: conceptFromText(label)
  })

  it('pairs fields with controls by concept first, then by shared words', () => {
    const fields = [
      field('Street', '1 Main St'),
      field('Postal code', '90210'),
      field('Membership number', 'M-77'),
      field('Email', 'me@example.com')
    ]
    const controls = [
      { concept: conceptFromAutocomplete('postal-code'), text: 'zip' },
      { concept: null, text: 'member_number Membership no.' },
      { concept: conceptFromText('address1 Street address'), text: 'address1 Street address' },
      { concept: conceptFromText('phone'), text: 'phone' }
    ]
    expect(matchFields(fields, controls)).toEqual([1, 2, 0, -1])
  })

  it('derives expiry month/year and first/last names', () => {
    const fields = expandFields([
      { label: 'Expiry', value: '8/27', concept: 'cc-exp' },
      { label: 'Cardholder name', value: 'Jane Q Doe', concept: 'cc-name' }
    ])
    expect(fields.slice(2)).toEqual([
      { label: 'Expiry month', value: '08', concept: 'cc-exp-month' },
      { label: 'Expiry year', value: '2027', concept: 'cc-exp-year' },
      { label: 'First name', value: 'Jane', concept: 'given-name' },
      { label: 'Last name', value: 'Doe', concept: 'family-name' }
    ])
  })

  it('formats dates the way the control asks', () => {
    const year: FillField = { label: 'Expiry year', value: '2027', concept: 'cc-exp-year' }
    const exp: FillField = { label: 'Expiry', value: '08/27', concept: 'cc-exp' }
    expect(formatForControl(year, { text: 'exp year', maxLength: 2 })).toBe('27')
    expect(formatForControl(year, { text: 'exp year', maxLength: -1 })).toBe('2027')
    expect(formatForControl(exp, { text: 'MM / YYYY', maxLength: -1 })).toBe('08/2027')
    expect(formatForControl(exp, { text: 'MM/YY', maxLength: 5 })).toBe('08/27')
    expect(splitExpiry('2027-08')).toEqual({ month: '08', year: '2027' })
    expect(splitExpiry('13/27')).toBeNull()
  })
})
