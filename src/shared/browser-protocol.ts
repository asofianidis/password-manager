/**
 * Messages between the browser extension and the desktop app. The browser launches the native
 * messaging host (src/main/browser/native-host.ts), which relays these as JSON over a local
 * socket to the running app.
 */

/** Native messaging host name registered with each browser */
export const NATIVE_HOST_NAME = 'com.password_manager.host'

/** Pinned with the `key` in the extension manifest, so unpacked installs get the same ID */
export const CHROME_EXTENSION_ID = 'mefnjmeinnpfdccbohalohcenfhjkmkb'
export const FIREFOX_EXTENSION_ID = 'password-manager@asofianidis'

export type BridgeRequest =
  /** `token` is optional so an unpaired extension can still see whether the vault is unlocked */
  | { type: 'status'; token?: string }
  /** Brings the app window to the front, launching the app if it isn't running */
  | { type: 'show' }
  /** Asks the user to approve this browser; resolves with a token once they do */
  | { type: 'pair'; browser: string }
  | { type: 'logins'; token: string; url: string }
  | { type: 'fill'; token: string; url: string; entryId: string }

export type BridgeError =
  | 'not-running'
  | 'not-paired'
  | 'denied'
  | 'busy'
  | 'locked'
  | 'no-vault'
  | 'no-match'
  | 'bad-request'

export interface BridgeStatus {
  state: 'no-vault' | 'locked' | 'unlocked'
  paired: boolean
}

export interface BridgeLogin {
  id: string
  title: string
  username: string
}

export interface BridgeCredentials {
  username: string
  password: string
}

export interface BridgeResults {
  status: BridgeStatus
  show: null
  pair: { token: string }
  logins: BridgeLogin[]
  fill: BridgeCredentials
}

export type BridgeResponse<T = unknown> =
  { ok: true; result: T } | { ok: false; error: BridgeError; message?: string }

/** Request/response envelope on the wire; `id` pairs a response with its request */
export type BridgeEnvelope = { id: number } & BridgeRequest
export type BridgeReply = { id: number } & BridgeResponse

/**
 * Unsolicited messages. `status`: the vault locked, unlocked, or changed, or a browser was
 * revoked. `connected`/`disconnected`: the native host gained or lost the app.
 */
export interface BridgeEvent {
  event: 'status' | 'connected' | 'disconnected'
}
