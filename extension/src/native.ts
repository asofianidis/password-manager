import {
  NATIVE_HOST_NAME,
  type BridgeError,
  type BridgeEvent,
  type BridgeReply,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeResults
} from '../../src/shared/browser-protocol'

/** Firefox exposes promise-based APIs on `browser`; Chromium on `chrome` */
export const ext: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome

/** The host isn't registered: the app has never been opened on this computer */
export type ClientError = BridgeError | 'not-installed' | 'timeout'

export type Response<T> = { ok: true; result: T } | { ok: false; error: ClientError }

interface Pending {
  resolve: (response: Response<unknown>) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * A long-lived connection to the native messaging host. Keeping the port open also keeps the
 * Chromium service worker alive, so the app can push status changes.
 */
export class NativeClient {
  private port: chrome.runtime.Port | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(private readonly onEvent: (event: BridgeEvent['event']) => void) {}

  request<T extends BridgeRequest['type']>(
    request: Extract<BridgeRequest, { type: T }>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<Response<BridgeResults[T]>> {
    const port = this.connect()
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: 'timeout' })
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as Pending['resolve'], timer })
      port.postMessage({ id, ...request })
    })
  }

  private connect(): chrome.runtime.Port {
    if (this.port) return this.port
    const port = ext.runtime.connectNative(NATIVE_HOST_NAME)
    port.onMessage.addListener((message: BridgeReply | BridgeEvent) => {
      if ('event' in message) return this.onEvent(message.event)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      pending.resolve(message as BridgeResponse)
    })
    port.onDisconnect.addListener(() => {
      // Chromium reports why on runtime.lastError; Firefox on port.error
      const reason =
        ext.runtime.lastError?.message ?? (port as { error?: { message: string } }).error?.message
      const error: ClientError = /not found|no such native application/i.test(reason ?? '')
        ? 'not-installed'
        : 'not-running'
      this.port = null
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.resolve({ ok: false, error })
        this.pending.delete(id)
      }
      // No event here: refreshing would reconnect, and if the host is missing, loop forever
    })
    this.port = port
    return port
  }
}
