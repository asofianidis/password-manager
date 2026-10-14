import type {
  EntryInput,
  EntrySummary,
  ExportFormat,
  GeneratedPassword,
  GeneratorOptions,
  HealthReport,
  ImportFile,
  ImportFormat,
  ImportPreview,
  Settings,
  SettingsPatch,
  StrengthResult,
  SyncPeer,
  SyncResult,
  SyncStatus,
  TailscalePeer,
  UpdateStatus,
  VaultEntry,
  VaultEvent,
  VaultStatus
} from './types'

/** Request/response API exposed to the renderer. Each key is also the IPC channel name. */
export interface InvokeApi {
  'vault:status': () => VaultStatus
  'vault:create': (masterPassword: string) => VaultStatus
  'vault:unlock': (masterPassword: string) => VaultStatus
  'vault:lock': () => VaultStatus
  'vault:change-master-password': (current: string, next: string) => void
  'vault:join': (host: string, port: number, code: string, masterPassword: string) => VaultStatus

  'entries:list': () => EntrySummary[]
  'entries:get': (id: string) => VaultEntry
  'entries:create': (input: EntryInput) => VaultEntry
  'entries:update': (id: string, input: EntryInput) => VaultEntry
  'entries:delete': (id: string) => void
  'entries:copy': (id: string, field: 'username' | 'password' | 'url') => void

  'health:report': () => HealthReport
  'strength:check': (password: string) => StrengthResult
  'generator:generate': (options: GeneratorOptions) => GeneratedPassword
  'clipboard:copy-secret': (text: string) => void

  'settings:get': () => Settings
  'settings:update': (patch: SettingsPatch) => Settings

  'import:pick-file': () => ImportFile | null
  'import:preview': (token: string, format: ImportFormat, password?: string) => ImportPreview
  'import:commit': (token: string, skipDuplicates: boolean) => number
  'import:cancel': (token: string) => void
  'export:save': (format: ExportFormat, exportPassword?: string) => string | null

  'sync:status': () => SyncStatus
  'sync:add-peer': (peer: { name: string; host: string; port: number }) => SyncPeer
  'sync:remove-peer': (id: string) => void
  'sync:now': (peerId?: string) => SyncResult[]
  'sync:start-pairing': () => SyncStatus
  'sync:stop-pairing': () => SyncStatus
  'sync:tailscale-peers': () => TailscalePeer[]

  'update:status': () => UpdateStatus
  'update:check': () => UpdateStatus
  'update:install': () => void
}

export type InvokeChannel = keyof InvokeApi

export const INVOKE_CHANNELS = [
  'vault:status',
  'vault:create',
  'vault:unlock',
  'vault:lock',
  'vault:change-master-password',
  'vault:join',
  'entries:list',
  'entries:get',
  'entries:create',
  'entries:update',
  'entries:delete',
  'entries:copy',
  'health:report',
  'strength:check',
  'generator:generate',
  'clipboard:copy-secret',
  'settings:get',
  'settings:update',
  'import:pick-file',
  'import:preview',
  'import:commit',
  'import:cancel',
  'export:save',
  'sync:status',
  'sync:add-peer',
  'sync:remove-peer',
  'sync:now',
  'sync:start-pairing',
  'sync:stop-pairing',
  'sync:tailscale-peers',
  'update:status',
  'update:check',
  'update:install'
] as const satisfies readonly InvokeChannel[]

/** IPC handlers wrap results so error messages survive the process boundary intact. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const EVENT_CHANNEL = 'vault:event'

export interface RendererApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: Parameters<InvokeApi[C]>
  ): Promise<Awaited<ReturnType<InvokeApi[C]>>>
  onEvent(listener: (event: VaultEvent) => void): () => void
}
