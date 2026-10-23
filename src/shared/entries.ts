import {
  IDENTITY_KINDS,
  ENTRY_TYPES,
  MAX_ATTACHMENTS_PER_ENTRY,
  type Attachment,
  type CardDetails,
  type EntryInput,
  type EntryType,
  type IdentityDetails,
  type IdentityKind,
  type VaultEntry
} from './types'

/** EntryInput with every field present and cleaned up. */
export interface CleanInput {
  type: EntryType
  title: string
  username: string
  password: string
  url: string
  notes: string
  totp: string
  folder: string
  favorite: boolean
  card: CardDetails
  identity: IdentityDetails
  attachments: Attachment[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export const EMPTY_CARD: CardDetails = { cardholder: '', number: '', expiry: '', cvv: '', pin: '' }

export const EMPTY_IDENTITY: IdentityDetails = {
  kind: 'passport',
  fullName: '',
  number: '',
  issuer: '',
  issuedOn: '',
  expiresOn: '',
  birthDate: ''
}

/** Builds card details with keys in canonical order. */
export function cleanCard(card: Partial<CardDetails> | undefined): CardDetails {
  return {
    cardholder: text(card?.cardholder).trim(),
    number: text(card?.number).replace(/[^\d]/g, ''),
    expiry: text(card?.expiry).trim(),
    cvv: text(card?.cvv).trim(),
    pin: text(card?.pin).trim()
  }
}

/** Builds identity details with keys in canonical order. */
export function cleanIdentity(identity: Partial<IdentityDetails> | undefined): IdentityDetails {
  const kind = IDENTITY_KINDS.includes(identity?.kind as IdentityKind)
    ? (identity!.kind as IdentityKind)
    : 'other'
  return {
    kind,
    fullName: text(identity?.fullName).trim(),
    number: text(identity?.number).trim(),
    issuer: text(identity?.issuer).trim(),
    issuedOn: text(identity?.issuedOn).trim(),
    expiresOn: text(identity?.expiresOn).trim(),
    birthDate: text(identity?.birthDate).trim()
  }
}

/** Attachment ids name files on disk, so they must be safe as file names. */
export const isAttachmentId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)

/** Builds attachments with keys in canonical order, dropping malformed ones and duplicates. */
export function cleanAttachments(list: unknown): Attachment[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const clean: Attachment[] = []
  for (const raw of list as Partial<Attachment>[]) {
    if (!isAttachmentId(raw?.id) || seen.has(raw.id) || typeof raw.key !== 'string') continue
    seen.add(raw.id)
    clean.push({
      id: raw.id,
      name: text(raw.name).trim().slice(0, 255) || 'file',
      mime: text(raw.mime).trim().slice(0, 100) || 'application/octet-stream',
      size: Number.isFinite(raw.size) ? Math.max(0, Math.floor(raw.size!)) : 0,
      key: raw.key,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt! : 0
    })
  }
  return clean.slice(0, MAX_ATTACHMENTS_PER_ENTRY)
}

export function sanitizeInput(input: EntryInput): CleanInput {
  const type = ENTRY_TYPES.includes(input.type as EntryType) ? input.type! : 'login'
  return {
    type,
    title: text(input.title).trim() || 'Untitled',
    username: text(input.username),
    password: text(input.password),
    url: text(input.url).trim(),
    notes: text(input.notes),
    totp: text(input.totp).trim(),
    folder: text(input.folder).trim(),
    favorite: Boolean(input.favorite),
    card: cleanCard(input.card),
    identity: cleanIdentity(input.identity),
    attachments: cleanAttachments(input.attachments)
  }
}

/**
 * Builds an entry with its keys in the canonical order (see docs/VAULT_FORMAT.md). The merge
 * tie-break compares JSON strings, so every client must write the same order.
 */
export function composeEntry(
  meta: Pick<VaultEntry, 'id' | 'createdAt' | 'updatedAt' | 'passwordUpdatedAt'>,
  clean: CleanInput
): VaultEntry {
  const entry: VaultEntry = {
    id: meta.id,
    title: clean.title,
    username: clean.username,
    password: clean.password,
    url: clean.url,
    notes: clean.notes,
    totp: clean.totp,
    folder: clean.folder,
    favorite: clean.favorite,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    passwordUpdatedAt: meta.passwordUpdatedAt
  }
  if (clean.type !== 'login') entry.type = clean.type
  if (clean.type === 'card') entry.card = clean.card
  if (clean.type === 'identity') entry.identity = clean.identity
  if (clean.attachments.length > 0) entry.attachments = clean.attachments
  return entry
}

/** The fields an editor works with, filled in for any entry. */
export function toInput(entry: VaultEntry): Required<EntryInput> {
  return {
    type: entry.type ?? 'login',
    title: entry.title,
    username: entry.username,
    password: entry.password,
    url: entry.url,
    notes: entry.notes,
    totp: entry.totp,
    folder: entry.folder,
    favorite: entry.favorite,
    card: entry.card ?? EMPTY_CARD,
    identity: entry.identity ?? EMPTY_IDENTITY,
    attachments: entry.attachments ?? []
  }
}

export const IDENTITY_KIND_LABELS: Record<IdentityKind, string> = {
  passport: 'Passport',
  'drivers-license': "Driver's license",
  'national-id': 'National ID',
  other: 'ID'
}

export const ENTRY_TYPE_LABELS: Record<EntryType, { one: string; many: string }> = {
  login: { one: 'Login', many: 'Logins' },
  card: { one: 'Card', many: 'Cards' },
  identity: { one: 'Photo ID', many: 'Photo IDs' },
  note: { one: 'Note', many: 'Notes' },
  document: { one: 'Document', many: 'Documents' }
}

/** Best guess at the card network from the number's prefix. */
export function cardBrand(number: string): string | null {
  const n = number.replace(/\D/g, '')
  if (/^4/.test(n)) return 'Visa'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'Mastercard'
  if (/^3[47]/.test(n)) return 'American Express'
  if (/^(6011|65|64[4-9])/.test(n)) return 'Discover'
  if (/^35(2[89]|[3-8])/.test(n)) return 'JCB'
  if (/^3(0[0-5]|[68])/.test(n)) return 'Diners Club'
  if (/^62/.test(n)) return 'UnionPay'
  return null
}

/** Groups card digits the way they're printed: 4-6-5 for Amex, fours otherwise. */
export function formatCardNumber(number: string): string {
  const n = number.replace(/\D/g, '')
  if (/^3[47]/.test(n))
    return [n.slice(0, 4), n.slice(4, 10), n.slice(10)].filter(Boolean).join(' ')
  return n.replace(/(.{4})(?=.)/g, '$1 ')
}

/** What "copy" copies for an entry: its password, card number, ID number, or note. */
export function primarySecret(entry: VaultEntry): string {
  switch (entry.type) {
    case 'card':
      return entry.card?.number ?? ''
    case 'identity':
      return entry.identity?.number ?? ''
    case 'note':
    case 'document':
      return entry.notes
    default:
      return entry.password
  }
}

/** The non-secret second line shown in lists. */
export function entryDetail(entry: VaultEntry): string {
  switch (entry.type) {
    case 'card': {
      const number = entry.card?.number ?? ''
      const brand = cardBrand(number)
      const last4 = number.length >= 4 ? `•••• ${number.slice(-4)}` : ''
      return [brand, last4].filter(Boolean).join(' ')
    }
    case 'identity': {
      const kind = IDENTITY_KIND_LABELS[entry.identity?.kind ?? 'other']
      return [kind, entry.identity?.issuer].filter(Boolean).join(' · ')
    }
    case 'note':
      return (
        entry.notes
          .split('\n')
          .find((line) => line.trim())
          ?.trim()
          .slice(0, 80) ?? ''
      )
    case 'document': {
      const count = entry.attachments?.length ?? 0
      return count === 1 ? entry.attachments![0].name : count ? `${count} files` : ''
    }
    default:
      return entry.username
  }
}
