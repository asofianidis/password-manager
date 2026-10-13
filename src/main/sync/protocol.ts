import type { VaultEntry } from '../../shared/types'
import type { VaultKeyHeader } from '../vault/vault'

/**
 * Peer-to-peer sync protocol, v1. Plain HTTP carrying AES-256-GCM payloads sealed with the
 * vault key, so only devices that hold the vault can read or produce valid messages. Run it over
 * Tailscale/WireGuard or a trusted LAN. See docs/SYNC_PROTOCOL.md.
 */
export const PROTOCOL_VERSION = 1

/** Max clock difference allowed between peers before a request is rejected as stale. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

export const PAIRING_DURATION_MS = 5 * 60 * 1000
export const MAX_PAIRING_ATTEMPTS = 5

/** GET /v1/hello */
export interface HelloResponse {
  app: 'pm'
  protocol: number
  deviceName: string
  vaultId: string | null
}

/** POST /v1/pair */
export interface PairRequest {
  code: string
}
export interface PairResponse {
  vaultId: string
  header: VaultKeyHeader
  deviceName: string
}

/** POST /v1/sync. `payload` is sealed SyncMessage, AAD = pm:sync-req:v1:<vaultId> */
export interface SyncRequest {
  vaultId: string
  nonce: string
  payload: string
}

/** Response `payload` is sealed SyncMessage, AAD = pm:sync-res:v1:<vaultId>:<nonce> */
export interface SyncResponse {
  payload: string
}

export interface SyncMessage {
  deviceId: string
  deviceName: string
  sentAt: number
  nonce: string
  header: VaultKeyHeader
  entries: VaultEntry[]
}

export interface ErrorResponse {
  error: string
}

export function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}
