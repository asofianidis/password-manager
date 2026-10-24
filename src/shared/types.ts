/** What an entry holds. Logins have no `type` field on disk. */
export type EntryType = 'login' | 'card' | 'identity' | 'note' | 'document'

export const ENTRY_TYPES: readonly EntryType[] = ['login', 'card', 'identity', 'note', 'document']

export interface CardDetails {
  cardholder: string
  number: string
  /** MM/YY */
  expiry: string
  cvv: string
  pin: string
}

export type IdentityKind = 'passport' | 'drivers-license' | 'national-id' | 'other'

export const IDENTITY_KINDS: readonly IdentityKind[] = [
  'passport',
  'drivers-license',
  'national-id',
  'other'
]

/** A photo ID. Dates are YYYY-MM-DD, or "" when unknown. */
export interface IdentityDetails {
  kind: IdentityKind
  fullName: string
  number: string
  /** Issuing country or state */
  issuer: string
  issuedOn: string
  expiresOn: string
  birthDate: string
}

/**
 * A file stored outside the vault data, in its own blob sealed with `key`. Attachments never
 * change: replacing a file adds a new attachment with a new id.
 */
export interface Attachment {
  id: string
  name: string
  mime: string
  /** Plaintext size in bytes */
  size: number
  /** base64 32-byte AES key for the blob */
  key: string
  createdAt: number
}

/** Largest file that can be attached */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_ENTRY = 20

/** A single stored item. Deleted entries are kept as tombstones so deletions sync. */
export interface VaultEntry {
  id: string
  title: string
  username: string
  password: string
  url: string
  notes: string
  totp: string
  folder: string
  favorite: boolean
  createdAt: number
  updatedAt: number
  passwordUpdatedAt: number
  /** Absent on logins */
  type?: Exclude<EntryType, 'login'>
  /** Present only when type is 'card' */
  card?: CardDetails
  /** Present only when type is 'identity' */
  identity?: IdentityDetails
  /** Absent when there are none */
  attachments?: Attachment[]
  deleted?: boolean
}

export type EntryInput = Pick<
  VaultEntry,
  'title' | 'username' | 'password' | 'url' | 'notes' | 'totp' | 'folder' | 'favorite'
> & {
  /** Defaults to 'login' */
  type?: EntryType
  card?: CardDetails
  identity?: IdentityDetails
  attachments?: Attachment[]
}

export const entryType = (entry: { type?: EntryType }): EntryType => entry.type ?? 'login'

export type StrengthScore = 0 | 1 | 2 | 3 | 4

/** Entry metadata sent to the renderer for lists; secrets are fetched on demand. */
export interface EntrySummary {
  id: string
  type: EntryType
  title: string
  /** A non-secret second line for lists: the card's last digits, the ID's kind, a note's first line */
  detail: string
  attachments: number
  username: string
  url: string
  folder: string
  favorite: boolean
  hasPassword: boolean
  hasTotp: boolean
  score: StrengthScore
  reused: boolean
  /** Password unchanged for longer than the configured threshold */
  old: boolean
  createdAt: number
  updatedAt: number
  passwordUpdatedAt: number
}

export type VaultState = 'no-vault' | 'locked' | 'unlocked'

export interface VaultStatus {
  state: VaultState
  vaultId: string | null
  /** Another device changed the master password, and it hasn't been entered here yet */
  pendingKeyChange: boolean
}

export interface StrengthResult {
  score: StrengthScore
  warning: string | null
  suggestions: string[]
  crackTime: string
}

export interface HealthReport {
  total: number
  weak: EntrySummary[]
  reused: EntrySummary[]
  old: EntrySummary[]
  empty: EntrySummary[]
  /** 0-100 overall score */
  score: number
}

export interface GeneratorOptions {
  mode: 'random' | 'passphrase'
  length: number
  uppercase: boolean
  lowercase: boolean
  digits: boolean
  symbols: boolean
  excludeAmbiguous: boolean
  words: number
  separator: string
  capitalize: boolean
  includeNumber: boolean
}

export interface GeneratedPassword {
  password: string
  strength: StrengthResult
}

export interface SyncPeer {
  id: string
  name: string
  host: string
  port: number
  lastSyncAt: number | null
  lastError: string | null
}

/** A browser extension the user approved to fill logins. Only a hash of its token is stored. */
export interface BrowserClient {
  id: string
  name: string
  tokenHash: string
  createdAt: number
  lastUsedAt: number | null
}

export interface Settings {
  deviceId: string
  deviceName: string
  autoLockMinutes: number
  lockOnSuspend: boolean
  clipboardClearSeconds: number
  oldPasswordDays: number
  /** Start in the tray / menu bar when the user logs in (Windows and macOS) */
  openAtLogin: boolean
  generator: GeneratorOptions
  sync: {
    serverEnabled: boolean
    bindAddress: string
    port: number
    autoSyncMinutes: number
    peers: SyncPeer[]
  }
  browser: {
    clients: BrowserClient[]
  }
}

export type SettingsPatch = Partial<
  Omit<Settings, 'deviceId' | 'generator' | 'sync' | 'browser'>
> & {
  generator?: Partial<GeneratorOptions>
  sync?: Partial<Omit<Settings['sync'], 'peers'>>
}

export interface PairingWindow {
  code: string
  expiresAt: number
}

export interface SyncStatus {
  serverRunning: boolean
  serverError: string | null
  listenAddresses: string[]
  pairing: PairingWindow | null
  syncing: boolean
}

export interface SyncResult {
  peerId: string
  ok: boolean
  error: string | null
  received: number
  sent: number
}

export interface TailscalePeer {
  name: string
  dnsName: string
  ips: string[]
  os: string
  online: boolean
  self: boolean
}

export type ImportFormat =
  | 'auto'
  | 'pm-json'
  | 'pm-encrypted'
  | 'dashlane-csv'
  | 'chrome-csv'
  | 'firefox-csv'
  | 'safari-csv'
  | 'bitwarden-csv'
  | 'bitwarden-json'
  | 'lastpass-csv'
  | '1password-csv'
  | '1password-1pux'
  | 'keepass-csv'
  | 'proton-csv'
  | 'generic-csv'

export interface ImportFile {
  token: string
  fileName: string
  detectedFormat: ImportFormat | null
  needsPassword: boolean
}

export interface ImportPreview {
  token: string
  format: ImportFormat
  total: number
  duplicates: number
  sample: { title: string; username: string; url: string }[]
  warnings: string[]
}

export type ExportFormat = 'pm-encrypted' | 'pm-json' | 'csv'

/** The Chromium extension folder the app keeps up to date */
export interface ExtensionFilesStatus {
  path: string
  version: string | null
  checking: boolean
  error: string | null
}

export interface BrowserBridgeStatus {
  /** Socket the native messaging host connects to; null if it failed to start */
  listening: boolean
  error: string | null
  /** Browsers the native messaging host was registered with on this launch */
  registered: string[]
  extension: ExtensionFilesStatus
}

/** Events pushed from the main process to the renderer. */
export type VaultEvent = 'locked' | 'changed' | 'sync-status' | 'update-status'

export interface UpdateStatus {
  /** idle: no update found (or not checked yet); ready: downloaded, installs on restart */
  state: 'idle' | 'available' | 'downloading' | 'ready'
  version: string | null
  /** Download progress, 0-100 */
  progress: number | null
  error: string | null
  /** Whether updates install in place; otherwise installing opens the release page */
  inPlace: boolean
}
