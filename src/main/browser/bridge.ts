import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { promises as fs } from 'fs'
import { createServer, type Server, type Socket } from 'net'
import type {
  BridgeEnvelope,
  BridgeError,
  BridgeEvent,
  BridgeLogin,
  BridgeReply,
  BridgeRequest,
  BridgeResponse,
  BridgeResults,
  BridgeStatus
} from '../../shared/browser-protocol'
import type { BrowserClient, VaultEntry, VaultStatus } from '../../shared/types'
import { LineDecoder, encodeLine } from './framing'
import { matchLevel } from './match'

const MAX_LOGINS = 20

export interface BridgeDeps {
  vault: { status(): VaultStatus; list(): VaultEntry[] }
  clients(): BrowserClient[]
  addClient(client: BrowserClient): Promise<void>
  touchClient(id: string): void
  extensionVersion(): string | null
  /** Asks the user whether to let this browser connect */
  confirmPair(browser: string): Promise<boolean>
  showApp(): void
}

class RequestError extends Error {
  constructor(readonly code: BridgeError) {
    super(code)
  }
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

function findClient(clients: BrowserClient[], token: unknown): BrowserClient | null {
  if (typeof token !== 'string' || !token) return null
  const hash = Buffer.from(hashToken(token), 'hex')
  return (
    clients.find((c) => {
      const stored = Buffer.from(c.tokenHash, 'hex')
      return stored.length === hash.length && timingSafeEqual(stored, hash)
    }) ?? null
  )
}

const str = (value: unknown, max = 2048): string => {
  if (typeof value !== 'string' || value.length > max) throw new RequestError('bad-request')
  return value
}

/** Builds the request handler. Kept free of Electron and sockets so it can be unit tested. */
export function createBridgeHandler(deps: BridgeDeps) {
  let pairing = false

  const requireClient = (token: unknown): BrowserClient => {
    const client = findClient(deps.clients(), token)
    if (!client) throw new RequestError('not-paired')
    return client
  }

  const unlockedEntries = (): VaultEntry[] => {
    const { state } = deps.vault.status()
    if (state === 'no-vault') throw new RequestError('no-vault')
    if (state === 'locked') throw new RequestError('locked')
    return deps.vault.list()
  }

  const handlers: {
    [T in BridgeRequest['type']]: (
      request: Extract<BridgeRequest, { type: T }>
    ) => BridgeResults[T] | Promise<BridgeResults[T]>
  } = {
    status: (request): BridgeStatus => ({
      state: deps.vault.status().state,
      paired: findClient(deps.clients(), request.token) !== null,
      extensionVersion: deps.extensionVersion()
    }),

    show: () => {
      deps.showApp()
      return null
    },

    pair: async (request) => {
      // One prompt at a time, so a misbehaving caller can't stack dialogs
      if (pairing) throw new RequestError('busy')
      const browser = str(request.browser, 200)
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .trim()
        .slice(0, 40)
      pairing = true
      try {
        if (!(await deps.confirmPair(browser || 'A browser'))) throw new RequestError('denied')
      } finally {
        pairing = false
      }
      const token = randomBytes(32).toString('base64url')
      await deps.addClient({
        id: randomUUID(),
        name: browser || 'Browser',
        tokenHash: hashToken(token),
        createdAt: Date.now(),
        lastUsedAt: null
      })
      return { token }
    },

    logins: (request): BridgeLogin[] => {
      requireClient(request.token)
      const url = str(request.url)
      return unlockedEntries()
        .map((entry) => ({ entry, level: matchLevel(entry.url, url) }))
        .filter(({ entry, level }) => level > 0 && (entry.username || entry.password))
        .sort(
          (a, b) =>
            b.level - a.level ||
            Number(b.entry.favorite) - Number(a.entry.favorite) ||
            a.entry.title.localeCompare(b.entry.title)
        )
        .slice(0, MAX_LOGINS)
        .map(({ entry }) => ({ id: entry.id, title: entry.title, username: entry.username }))
    },

    fill: (request) => {
      const client = requireClient(request.token)
      const url = str(request.url)
      const entryId = str(request.entryId, 200)
      const entry = unlockedEntries().find((e) => e.id === entryId)
      // The extension picked this login for a page; re-check it here so a confused or
      // compromised extension can't pull credentials for some other site
      if (!entry || matchLevel(entry.url, url) === 0) throw new RequestError('no-match')
      deps.touchClient(client.id)
      return { username: entry.username, password: entry.password }
    }
  }

  return async (request: BridgeRequest): Promise<BridgeResponse> => {
    try {
      const handler = handlers[request?.type] as
        ((r: BridgeRequest) => unknown | Promise<unknown>) | undefined
      if (!handler) throw new RequestError('bad-request')
      return { ok: true, result: await handler(request) }
    } catch (error) {
      if (error instanceof RequestError) return { ok: false, error: error.code }
      return {
        ok: false,
        error: 'bad-request',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

/**
 * Listens on a local socket for native messaging hosts. On macOS and Linux it's a Unix socket in
 * the user-only app data folder; on Windows a named pipe, which only the same user can open for
 * writing.
 */
export class BridgeServer {
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()

  constructor(
    private readonly path: string,
    private readonly handle: (request: BridgeRequest) => Promise<BridgeResponse>
  ) {}

  async start(): Promise<void> {
    if (process.platform !== 'win32') {
      // A previous run that crashed leaves the socket file behind
      await fs.rm(this.path, { force: true })
    }
    const server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.path, () => {
        server.off('error', reject)
        resolve()
      })
    })
    if (process.platform !== 'win32') await fs.chmod(this.path, 0o600)
    this.server = server
  }

  /** Tells connected extensions to refresh, e.g. after the vault locks or unlocks. */
  notify(): void {
    const event: BridgeEvent = { event: 'status' }
    for (const socket of this.sockets) socket.write(encodeLine(event))
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve()
    )
    this.server = null
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    const lines = new LineDecoder()
    socket.on('data', (chunk) => {
      let messages: unknown[]
      try {
        messages = lines.push(chunk)
      } catch {
        socket.destroy()
        return
      }
      for (const message of messages) {
        const { id, ...request } = message as BridgeEnvelope
        void this.handle(request as BridgeRequest).then((response) => {
          if (!socket.destroyed) socket.write(encodeLine({ id, ...response } as BridgeReply))
        })
      }
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => this.sockets.delete(socket))
  }
}
