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
  /** Which vault key sealed `payload` (keyIdOf). Requests without one are only tried with the current key. */
  keyId?: string
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

/** POST /v1/attachments. `payload` is sealed AttachmentRequest, AAD = pm:att-req:v1:<vaultId> */
export interface AttachmentEnvelope {
  vaultId: string
  keyId: string
  nonce: string
  payload: string
}

/** An attachment file's contents: the attachment sealed with its own key, base64 */
export interface AttachmentBlob {
  id: string
  data: string
}

export interface AttachmentRequest {
  nonce: string
  sentAt: number
  /** Files the sender lacks and wants */
  want: string[]
  /** Files the sender has; the reply lists the ones the receiver lacks */
  check: string[]
  /** Files the receiver asked for */
  put: AttachmentBlob[]
}

/** Response `payload` is sealed AttachmentResponse, AAD = pm:att-res:v1:<vaultId>:<nonce> */
export interface AttachmentResponse {
  attachments: AttachmentBlob[]
  /** Wanted ids that can't be sent; wanted ids in neither list were held back for size */
  missing: string[]
  /** Checked ids the receiver lacks */
  need: string[]
}

/** Files in one attachment message stop once their total passes this (one file always goes) */
export const ATTACHMENT_BATCH_BYTES = 12 * 1024 * 1024
export const MAX_WANT = 1000
export const MAX_CHECK = 10_000

export interface ErrorResponse {
  error: string
}

export function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}
