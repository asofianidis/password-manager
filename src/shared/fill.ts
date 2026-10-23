import { IDENTITY_KIND_LABELS } from './entries'
import type { VaultEntry } from './types'

/**
 * Filling arbitrary web forms from notes, cards, and IDs. The app turns an entry into labelled
 * fields (fillableFields); the extension's content script matches them to the inputs on the page
 * (matchFields). Kept free of DOM and Node APIs so both sides can use it.
 */

/** Kinds of form field that can be recognized from a label or an autocomplete attribute. */
export type FillConcept =
  | 'cc-name'
  | 'cc-number'
  | 'cc-exp'
  | 'cc-exp-month'
  | 'cc-exp-year'
  | 'cc-csc'
  | 'email'
  | 'tel'
  | 'given-name'
  | 'family-name'
  | 'name'
  | 'bday'
  | 'postal-code'
  | 'address-line2'
  | 'address-line1'
  | 'address-level2'
  | 'address-level1'
  | 'country'
  | 'organization'
  | 'username'
  | 'url'
  | 'id-number'

export interface FillField {
  label: string
  value: string
  /** What the field is, if known; matched against what page inputs are */
  concept: FillConcept | null
}

/** Checked in order, so more specific patterns come first ("card name" before "name"). */
const TEXT_PATTERNS: [FillConcept, RegExp][] = [
  ['cc-name', /\b(card ?holder|name on (the )?card|cc ?name|card ?name)\b/],
  ['cc-number', /\b(card ?(number|no|num)|cc ?(number|num|no)|credit ?card|debit ?card|pan)\b/],
  ['cc-exp-month', /\b(exp\w*|cc|card) ?(month|mm)\b/],
  ['cc-exp-year', /\b(exp\w*|cc|card) ?(year|yy|yyyy)\b/],
  ['cc-exp', /\b(exp|expiry|expiration|expires|valid ?(thru|through|until)|mm ?yy(yy)?)\b/],
  ['cc-csc', /\b(cvv2?|cvc2?|csc|cid|security ?code|card ?code|verification ?(code|number))\b/],
  ['email', /\be ?mail\b/],
  ['tel', /\b(phone|mobile|cell|tel|telephone)\b/],
  ['given-name', /\b(first ?name|given ?name|forename|fname)\b/],
  ['family-name', /\b(last ?name|surname|family ?name|lname)\b/],
  ['bday', /\b(birth ?date|date of birth|dob|bday|birthday|born)\b/],
  ['postal-code', /\b(zip( ?code)?|postal( ?code)?|post ?code|postcode)\b/],
  ['address-line2', /\b(address ?(line)? ?2|apt|apartment|suite|unit|flat)\b/],
  ['address-line1', /\b(address ?(line)? ?1|street( ?address)?|address)\b/],
  ['address-level2', /\b(city|town|locality|suburb)\b/],
  ['address-level1', /\b(state|province|region|county|prefecture)\b/],
  ['country', /\bcountry\b/],
  ['organization', /\b(company|organi[sz]ation|employer|business name)\b/],
  ['username', /\b(user ?name|user ?id|login)\b/],
  ['url', /\b(website|homepage|url)\b/],
  [
    'id-number',
    /\b((passport|licen[cs]e|document|national ?id|id) ?(number|no|num)|passport|licen[cs]e)\b/
  ],
  ['name', /\b(full ?name|your ?name|name)\b/]
]

const AUTOCOMPLETE: Record<string, FillConcept> = {
  'cc-name': 'cc-name',
  'cc-number': 'cc-number',
  'cc-exp': 'cc-exp',
  'cc-exp-month': 'cc-exp-month',
  'cc-exp-year': 'cc-exp-year',
  'cc-csc': 'cc-csc',
  email: 'email',
  tel: 'tel',
  'tel-national': 'tel',
  'given-name': 'given-name',
  'family-name': 'family-name',
  name: 'name',
  bday: 'bday',
  'postal-code': 'postal-code',
  'street-address': 'address-line1',
  'address-line1': 'address-line1',
  'address-line2': 'address-line2',
  'address-level2': 'address-level2',
  'address-level1': 'address-level1',
  country: 'country',
  'country-name': 'country',
  organization: 'organization',
  username: 'username',
  url: 'url'
}

/** Lowercases and splits camelCase, snake_case, and punctuation into words. */
export function normalizeText(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function conceptFromText(text: string): FillConcept | null {
  const normalized = normalizeText(text)
  if (!normalized) return null
  return TEXT_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null
}

/** Reads an autocomplete attribute such as "shipping postal-code". */
export function conceptFromAutocomplete(value: string): FillConcept | null {
  for (const token of value.toLowerCase().split(/\s+/).reverse()) {
    if (AUTOCOMPLETE[token]) return AUTOCOMPLETE[token]
  }
  return null
}

/**
 * Finds "Label: value" lines in a note. URLs ("https://…") and lines without a letter in the
 * label aren't fields.
 */
export function parseNoteFields(notes: string): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = []
  for (const line of notes.split(/\r?\n/)) {
    const match = /^\s*([^:]{1,60}?)\s*:\s*(.*\S)\s*$/.exec(line)
    if (!match) continue
    const [, label, value] = match
    if (!/\p{L}/u.test(label) || value.startsWith('//')) continue
    fields.push({ label, value })
  }
  return fields
}

const MAX_FIELDS = 40

/** The fields an entry offers for filling forms. Logins have none; they fill login forms. */
export function fillableFields(entry: VaultEntry): FillField[] {
  if (!entry.type) return []
  const fields: FillField[] = []
  const add = (label: string, value: string, concept: FillConcept | null): void => {
    if (value) fields.push({ label, value, concept })
  }
  if (entry.type === 'card' && entry.card) {
    // The PIN is for card readers and ATMs, never for websites
    add('Cardholder name', entry.card.cardholder, 'cc-name')
    add('Card number', entry.card.number, 'cc-number')
    add('Expiry', entry.card.expiry, 'cc-exp')
    add('Security code', entry.card.cvv, 'cc-csc')
  } else if (entry.type === 'identity' && entry.identity) {
    const id = entry.identity
    add('Full name', id.fullName, 'name')
    add(`${IDENTITY_KIND_LABELS[id.kind] ?? 'ID'} number`, id.number, 'id-number')
    add('Date of birth', id.birthDate, 'bday')
    add('Issued by', id.issuer, null)
    add('Issue date', id.issuedOn, null)
    add('Expiry date', id.expiresOn, null)
  }

  const lines = parseNoteFields(entry.notes)
  for (const { label, value } of lines) add(label, value, conceptFromText(label))
  // A note without "Label: value" lines can still be pasted into a field whole
  if (entry.type === 'note' && lines.length === 0) add('Note text', entry.notes.trim(), null)
  return fields.slice(0, MAX_FIELDS)
}

/** Splits an expiry ("08/27", "8/2027", "2027-08") into a two-digit month and four-digit year. */
export function splitExpiry(expiry: string): { month: string; year: string } | null {
  const iso = /^(\d{4})\D(\d{1,2})$/.exec(expiry.trim())
  const typed = /^(\d{1,2})\s*\D\s*(\d{2}|\d{4})$/.exec(expiry.trim())
  const [month, year] = iso ? [iso[2], iso[1]] : typed ? [typed[1], typed[2]] : []
  if (!month || !year || Number(month) < 1 || Number(month) > 12) return null
  return { month: month.padStart(2, '0'), year: year.length === 2 ? `20${year}` : year }
}

/**
 * Adds fields that can be worked out from others: the expiry month and year from a card's
 * expiry, and first and last names from a full name.
 */
export function expandFields(fields: FillField[]): FillField[] {
  const out = [...fields]
  const has = (concept: FillConcept): boolean => out.some((f) => f.concept === concept)
  const expiry = fields.find((f) => f.concept === 'cc-exp')
  const parts = expiry && splitExpiry(expiry.value)
  if (parts) {
    if (!has('cc-exp-month'))
      out.push({ label: 'Expiry month', value: parts.month, concept: 'cc-exp-month' })
    if (!has('cc-exp-year'))
      out.push({ label: 'Expiry year', value: parts.year, concept: 'cc-exp-year' })
  }
  const name = fields.find((f) => f.concept === 'name' || f.concept === 'cc-name')
  const words = name?.value.trim().split(/\s+/) ?? []
  if (words.length >= 2) {
    if (!has('given-name'))
      out.push({ label: 'First name', value: words[0], concept: 'given-name' })
    if (!has('family-name'))
      out.push({ label: 'Last name', value: words.at(-1)!, concept: 'family-name' })
  }
  return out
}

/** What the content script knows about a form control. */
export interface ControlInfo {
  /** From the autocomplete attribute, else from the descriptive text */
  concept: FillConcept | null
  /** Name, id, placeholder, aria-label, and label text */
  text: string
}

const STOP_WORDS = new Set(['the', 'your', 'of', 'and', 'or', 'for', 'a', 'an', 'my', 'to'])

const words = (text: string): string[] =>
  normalizeText(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))

/** How well a field fits a control, 0 for not at all. */
export function matchScore(field: FillField, control: ControlInfo): number {
  // When both are recognized, trust that over the wording
  if (field.concept && control.concept) return field.concept === control.concept ? 100 : 0
  const label = words(field.label)
  if (label.length === 0) return 0
  const text = new Set(words(control.text))
  const found = label.filter((w) => text.has(w)).length
  if (found === label.length) return 60
  return found / label.length >= 0.5 ? 30 : 0
}

/**
 * Pairs fields with controls, best matches first; each control and each field is used once.
 * Returns the index of the field chosen for each control, or -1.
 */
export function matchFields(fields: FillField[], controls: ControlInfo[]): number[] {
  const pairs: { field: number; control: number; score: number }[] = []
  controls.forEach((control, c) =>
    fields.forEach((field, f) => {
      const score = matchScore(field, control)
      if (score > 0) pairs.push({ field: f, control: c, score })
    })
  )
  pairs.sort((a, b) => b.score - a.score || a.control - b.control)
  const chosen = controls.map(() => -1)
  const used = new Set<number>()
  for (const { field, control } of pairs) {
    if (chosen[control] !== -1 || used.has(field)) continue
    chosen[control] = field
    used.add(field)
  }
  return chosen
}

/**
 * Adapts a value to the control it goes into: two-digit years where the control wants them, and
 * expiry dates in the control's MM/YY or MM/YYYY format.
 */
export function formatForControl(
  field: FillField,
  control: { text: string; maxLength: number }
): string {
  const hint = normalizeText(control.text)
  if (field.concept === 'cc-exp-year') {
    const short = (control.maxLength > 0 && control.maxLength <= 2) || /\byy\b/.test(hint)
    return short ? field.value.slice(-2) : field.value
  }
  if (field.concept === 'cc-exp') {
    const parts = splitExpiry(field.value)
    if (!parts) return field.value
    const long = /yyyy/.test(hint) || control.maxLength >= 7
    return `${parts.month}/${long ? parts.year : parts.year.slice(-2)}`
  }
  return field.value
}
