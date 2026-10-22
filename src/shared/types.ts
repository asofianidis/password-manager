/** A single stored credential. Deleted entries are kept as tombstones so deletions sync. */
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
  deleted?: boolean
}

export type EntryInput = Pick<
  VaultEntry,
  'title' | 'username' | 'password' | 'url' | 'notes' | 'totp' | 'folder' | 'favorite'
>

export type StrengthScore = 0 | 1 | 2 | 3 | 4

/** Entry metadata sent to the renderer for lists; secrets are fetched on demand. */
export interface EntrySummary {
  id: string
  title: string
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
}
