import type { EntryInput, ImportFormat } from './types'
import { parseCsvRecords } from './csv'

export type ImportedEntry = EntryInput & { createdAt?: number; updatedAt?: number }

export interface ParsedImport {
  entries: ImportedEntry[]
  warnings: string[]
}

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  auto: 'Auto-detect',
  'pm-json': 'This app — JSON export',
  'pm-encrypted': 'This app — encrypted backup',
  'dashlane-csv': 'Dashlane (CSV / ZIP)',
  'chrome-csv': 'Chrome / Edge / Brave / Opera (CSV)',
  'firefox-csv': 'Firefox (CSV)',
  'safari-csv': 'Apple Passwords / Safari (CSV)',
  'bitwarden-csv': 'Bitwarden (CSV)',
  'bitwarden-json': 'Bitwarden (JSON, unencrypted)',
  'lastpass-csv': 'LastPass (CSV)',
  '1password-csv': '1Password (CSV)',
  '1password-1pux': '1Password (1PUX)',
  'keepass-csv': 'KeePass / KeePassXC (CSV)',
  'proton-csv': 'Proton Pass (CSV)',
  'generic-csv': 'Generic CSV'
}

type CsvFormat = Extract<ImportFormat, `${string}-csv`>

/**
 * Column aliases per CSV format, checked in order. Header names are lower-cased.
 * `signature` columns must all be present for auto-detection to pick the format.
 */
const CSV_FORMATS: Record<
  CsvFormat,
  {
    signature: string[]
    title: string[]
    username: string[]
    password: string[]
    url: string[]
    notes: string[]
    totp: string[]
    folder: string[]
    favorite?: string[]
    /** Extra columns appended to notes when non-empty */
    extraNotes?: string[]
  }
> = {
  'dashlane-csv': {
    signature: ['username', 'username2', 'username3', 'title', 'password'],
    title: ['title'],
    username: ['username', 'username2', 'username3'],
    password: ['password'],
    url: ['url'],
    notes: ['note'],
    totp: ['otpurl', 'otpsecret'],
    folder: ['category']
  },
  'bitwarden-csv': {
    signature: ['login_uri', 'login_username', 'login_password'],
    title: ['name'],
    username: ['login_username'],
    password: ['login_password'],
    url: ['login_uri'],
    notes: ['notes'],
    totp: ['login_totp'],
    folder: ['folder'],
    favorite: ['favorite'],
    extraNotes: ['fields']
  },
  'lastpass-csv': {
    signature: ['url', 'username', 'password', 'extra', 'name', 'grouping'],
    title: ['name'],
    username: ['username'],
    password: ['password'],
    url: ['url'],
    notes: ['extra'],
    totp: ['totp'],
    folder: ['grouping'],
    favorite: ['fav']
  },
  'firefox-csv': {
    signature: ['url', 'username', 'password', 'httprealm', 'formactionorigin'],
    title: [],
    username: ['username'],
    password: ['password'],
    url: ['url'],
    notes: [],
    totp: [],
    folder: []
  },
  'keepass-csv': {
    signature: ['group', 'title', 'username', 'password', 'url', 'notes'],
    title: ['title'],
    username: ['username'],
    password: ['password'],
    url: ['url'],
    notes: ['notes'],
    totp: ['totp'],
    folder: ['group']
  },
  'proton-csv': {
    signature: ['type', 'name', 'url', 'email', 'username', 'password', 'note', 'totp'],
    title: ['name'],
    username: ['username', 'email'],
    password: ['password'],
    url: ['url'],
    notes: ['note'],
    totp: ['totp'],
    folder: ['vault']
  },
  '1password-csv': {
    signature: ['title', 'url', 'username', 'password', 'otpauth', 'favorite', 'archived', 'tags'],
    title: ['title'],
    username: ['username'],
    password: ['password'],
    url: ['url'],
    notes: ['notes'],
    totp: ['otpauth'],
    folder: ['tags'],
    favorite: ['favorite']
  },
  'safari-csv': {
    signature: ['title', 'url', 'username', 'password', 'otpauth'],
    title: ['title'],
    username: ['username'],
    password: ['password'],
    url: ['url'],
    notes: ['notes'],
    totp: ['otpauth'],
    folder: []
  },
  'chrome-csv': {
    signature: ['name', 'url', 'username', 'password'],
    title: ['name'],
    username: ['username'],
    password: ['password'],
    url: ['url'],
    notes: ['note', 'notes'],
    totp: [],
    folder: []
  },
  'generic-csv': {
    signature: [],
    title: ['title', 'name', 'account', 'site', 'website name', 'item name', 'entry'],
    username: [
      'username',
      'user',
      'login',
      'login name',
      'email',
      'e-mail',
      'user name',
      'login_username'
    ],
    password: ['password', 'pass', 'login_password', 'pwd'],
    url: ['url', 'website', 'uri', 'login_uri', 'web site', 'address', 'link', 'site url'],
    notes: ['notes', 'note', 'comments', 'extra', 'description'],
    totp: ['totp', 'otp', 'otpauth', 'otpurl', 'one-time password', '2fa'],
    folder: ['folder', 'group', 'category', 'grouping', 'vault'],
    favorite: ['favorite', 'fav']
  }
}

/** Order matters: more specific signatures first so supersets win. */
const DETECTION_ORDER: CsvFormat[] = [
  'dashlane-csv',
  'bitwarden-csv',
  'lastpass-csv',
  'firefox-csv',
  'keepass-csv',
  'proton-csv',
  '1password-csv',
  'safari-csv',
  'chrome-csv'
]

export function detectFormat(fileName: string, text: string): ImportFormat | null {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed)
      if (json?.format === 'pm-export') return json.encrypted ? 'pm-encrypted' : 'pm-json'
      if (Array.isArray(json?.items) && 'encrypted' in json) return 'bitwarden-json'
      if (Array.isArray(json?.accounts)) return '1password-1pux'
    } catch {
      return null
    }
    return null
  }

  const { headers } = parseCsvRecords(text.split(/\r?\n/, 1)[0] ?? '')
  const headerSet = new Set(headers)
  for (const format of DETECTION_ORDER) {
    if (CSV_FORMATS[format].signature.every((column) => headerSet.has(column))) return format
  }
  if (fileName.toLowerCase().endsWith('.csv') && headers.length > 0) return 'generic-csv'
  return null
}

function pick(record: Record<string, string>, columns: string[]): string {
  for (const column of columns) {
    const value = record[column]?.trim()
    if (value) return value
  }
  return ''
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'y', 'x'].includes(value.trim().toLowerCase())
}

/** Builds a readable title when the source has none, e.g. "github.com". */
export function titleFromUrl(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function finalize(entry: ImportedEntry): ImportedEntry {
  const title = entry.title || titleFromUrl(entry.url) || entry.username || 'Untitled'
  return { ...entry, title }
}

export function parseCsvImport(format: CsvFormat, text: string): ParsedImport {
  const mapping = CSV_FORMATS[format]
  const { headers, records } = parseCsvRecords(text)
  const warnings: string[] = []

  if (!headers.some((h) => mapping.password.includes(h))) {
    warnings.push('No password column was found. Check that the right format is selected.')
  }

  let skipped = 0
  const entries: ImportedEntry[] = []
  for (const record of records) {
    // Proton Pass, Bitwarden, and LastPass exports include non-login items (notes, cards)
    const type = record['type']?.toLowerCase()
    if (format === 'bitwarden-csv' && type && type !== 'login') {
      skipped++
      continue
    }
    if (format === 'proton-csv' && type && type !== 'login') {
      skipped++
      continue
    }
    if (format === 'lastpass-csv' && record['url'] === 'http://sn' && !record['password']) {
      skipped++
      continue
    }

    const extra = (mapping.extraNotes ?? []).map((column) => record[column]?.trim()).filter(Boolean)
    const notes = [pick(record, mapping.notes), ...extra].filter(Boolean).join('\n\n')

    const entry = finalize({
      title: pick(record, mapping.title),
      username: pick(record, mapping.username),
      password: pick(record, mapping.password),
      url: pick(record, mapping.url),
      notes,
      totp: pick(record, mapping.totp),
      folder: pick(record, mapping.folder),
      favorite: mapping.favorite ? truthy(pick(record, mapping.favorite)) : false
    })

    if (!entry.password && !entry.username && !entry.url) {
      skipped++
      continue
    }
    entries.push(entry)
  }

  if (skipped > 0) warnings.push(`${skipped} non-login or empty item(s) were skipped.`)
  return { entries, warnings }
}

interface BitwardenItem {
  type: number
  name?: string
  notes?: string | null
  favorite?: boolean
  folderId?: string | null
  login?: {
    username?: string | null
    password?: string | null
    totp?: string | null
    uris?: { uri?: string | null }[] | null
  }
}

export function parseBitwardenJson(text: string): ParsedImport {
  const json = JSON.parse(text) as {
    encrypted?: boolean
    folders?: { id: string; name: string }[]
    items?: BitwardenItem[]
  }
  if (json.encrypted) {
    throw new Error('Encrypted Bitwarden exports are not supported. Export as unencrypted JSON.')
  }
  const folders = new Map((json.folders ?? []).map((f) => [f.id, f.name]))
  const items = json.items ?? []
  const logins = items.filter((item) => item.type === 1 && item.login)
  const warnings: string[] = []
  if (logins.length < items.length) {
    warnings.push(`${items.length - logins.length} non-login item(s) were skipped.`)
  }
  const entries = logins.map((item) =>
    finalize({
      title: item.name ?? '',
      username: item.login?.username ?? '',
      password: item.login?.password ?? '',
      url: item.login?.uris?.find((u) => u.uri)?.uri ?? '',
      notes: item.notes ?? '',
      totp: item.login?.totp ?? '',
      folder: (item.folderId && folders.get(item.folderId)) || '',
      favorite: Boolean(item.favorite)
    })
  )
  return { entries, warnings }
}

interface OnePuxItem {
  categoryUuid?: string
  state?: string
  favIndex?: number
  createdAt?: number
  updatedAt?: number
  overview?: { title?: string; url?: string; urls?: { url?: string }[]; tags?: string[] }
  details?: {
    loginFields?: { designation?: string; value?: string; fieldType?: string }[]
    notesPlain?: string
    password?: string
    sections?: { fields?: { value?: { totp?: string } }[] }[]
  }
}

/** 1Password 1PUX: a ZIP containing export.data (JSON). The caller extracts export.data. */
export function parseOnePux(text: string): ParsedImport {
  const json = JSON.parse(text) as {
    accounts?: { vaults?: { attrs?: { name?: string }; items?: OnePuxItem[] }[] }[]
  }
  const entries: ImportedEntry[] = []
  let skipped = 0

  for (const account of json.accounts ?? []) {
    for (const vault of account.vaults ?? []) {
      for (const item of vault.items ?? []) {
        // 001 = Login, 005 = Password
        if (item.state === 'archived' || !['001', '005'].includes(item.categoryUuid ?? '')) {
          skipped++
          continue
        }
        const fields = item.details?.loginFields ?? []
        const username = fields.find((f) => f.designation === 'username')?.value ?? ''
        const password =
          fields.find((f) => f.designation === 'password')?.value ?? item.details?.password ?? ''
        const totp =
          item.details?.sections?.flatMap((s) => s.fields ?? []).find((f) => f.value?.totp)?.value
            ?.totp ?? ''
        entries.push(
          finalize({
            title: item.overview?.title ?? '',
            username,
            password,
            url: item.overview?.url || item.overview?.urls?.[0]?.url || '',
            notes: item.details?.notesPlain ?? '',
            totp,
            folder: vault.attrs?.name ?? '',
            favorite: (item.favIndex ?? 0) > 0,
            createdAt: item.createdAt ? item.createdAt * 1000 : undefined,
            updatedAt: item.updatedAt ? item.updatedAt * 1000 : undefined
          })
        )
      }
    }
  }

  const warnings = skipped > 0 ? [`${skipped} non-login or archived item(s) were skipped.`] : []
  return { entries, warnings }
}

/** Parses a plaintext export from this app. */
export function parsePmJson(text: string): ParsedImport {
  const json = JSON.parse(text) as { format?: string; entries?: Partial<ImportedEntry>[] }
  if (json.format !== 'pm-export' || !Array.isArray(json.entries)) {
    throw new Error('This is not a Password Manager export file.')
  }
  return { entries: json.entries.map(normalizeImported), warnings: [] }
}

export function normalizeImported(raw: Partial<ImportedEntry>): ImportedEntry {
  return finalize({
    title: String(raw.title ?? ''),
    username: String(raw.username ?? ''),
    password: String(raw.password ?? ''),
    url: String(raw.url ?? ''),
    notes: String(raw.notes ?? ''),
    totp: String(raw.totp ?? ''),
    folder: String(raw.folder ?? ''),
    favorite: Boolean(raw.favorite),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined
  })
}

/** Parses any non-encrypted format. Encrypted exports are decrypted by the main process first. */
export function parseImport(
  format: Exclude<ImportFormat, 'auto' | 'pm-encrypted'>,
  text: string
): ParsedImport {
  switch (format) {
    case 'pm-json':
      return parsePmJson(text)
    case 'bitwarden-json':
      return parseBitwardenJson(text)
    case '1password-1pux':
      return parseOnePux(text)
    default:
      return parseCsvImport(format, text)
  }
}

/** Key used to detect duplicates between imported and existing entries. */
export function duplicateKey(entry: { url: string; username: string; password: string }): string {
  return [titleFromUrl(entry.url).toLowerCase(), entry.username.toLowerCase(), entry.password].join(
    '\u0000'
  )
}
