import type { FillField } from './fill'
import type { EntryType } from './types'

/**
 * Messages between the browser extension and the desktop app. The browser launches the native
 * messaging host (src/main/browser/native-host.ts), which relays these as JSON over a local
 * socket to the running app.
 */

/** Native messaging host name registered with each browser */
export const NATIVE_HOST_NAME = 'com.password_manager.host'

/** Pinned with the `key` in the extension manifest, so unpacked installs get the same ID */
export const CHROME_EXTENSION_ID = 'mefnjmeinnpfdccbohalohcenfhjkmkb'
/** Assigned by the Chrome Web Store, which won't accept a manifest with a `key` */
export const CHROME_STORE_EXTENSION_ID = 'mkjahdipmeoophagaligpclkaklfjekj'
export const FIREFOX_EXTENSION_ID = 'password-manager@asofianidis'

/**
 * A rolling pre-release that CI updates whenever the extension is released. It holds
 * extension.json (read by the app, see ExtensionChannel) and updates.json (read by Firefox).
 * Being a pre-release, it never becomes the "Latest" release the app's own updater reads.
 */
export const EXTENSION_CHANNEL_URL =
  'https://github.com/asofianidis/password-manager/releases/download/extension-latest'

/** Downloads must come from this repo's releases */
export const RELEASE_DOWNLOAD_PREFIX =
  'https://github.com/asofianidis/password-manager/releases/download/'

export interface ExtensionChannel {
  version: string
  chrome: { url: string; sha256: string }
}

export type BridgeRequest =
  /** `token` is optional so an unpaired extension can still see whether the vault is unlocked */
  | { type: 'status'; token?: string }
  /** Brings the app window to the front, launching the app if it isn't running */
  | { type: 'show' }
  /** Asks the user to approve this browser; resolves with a token once they do */
  | { type: 'pair'; browser: string }
  | { type: 'logins'; token: string; url: string }
  | { type: 'fill'; token: string; url: string; entryId: string }
  /** Notes, cards, and IDs that can fill forms on any site, with their field labels */
  | { type: 'fillables'; token: string }
  | { type: 'fill-fields'; token: string; entryId: string }

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
  /**
   * Version of the Chromium extension in the folder the app manages. When it's newer than the
   * running extension, the extension reloads itself to pick up the new files.
   */
  extensionVersion: string | null
}

export interface BridgeLogin {
  id: string
  title: string
  username: string
}

/** An entry that can fill forms. Only labels are listed; values come with fill-fields. */
export interface BridgeFillable {
  id: string
  type: EntryType
  title: string
  labels: string[]
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
  fillables: BridgeFillable[]
  'fill-fields': FillField[]
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

/** Compares dotted numeric versions ("1.0.10" > "1.0.9"); a missing version is the oldest. */
export function compareVersions(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}
