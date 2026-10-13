import { EventEmitter } from 'events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto'
import type { PairingWindow, SyncPeer, SyncResult, SyncStatus } from '../../shared/types'
import { AAD, DecryptionError, openJson, sealJson } from '../vault/crypto'
import { vault } from '../vault/vault'
import { settingsStore } from '../settings'
import {
  MAX_CLOCK_SKEW_MS,
  MAX_PAIRING_ATTEMPTS,
  PAIRING_DURATION_MS,
  PROTOCOL_VERSION,
  formatHost,
  type HelloResponse,
  type PairRequest,
  type PairResponse,
  type SyncMessage,
  type SyncRequest,
  type SyncResponse
} from './protocol'

const MAX_BODY_BYTES = 25 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
      } catch {
        reject(new HttpError(400, 'Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store'
  })
  res.end(data)
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code
    throw new Error(cause ? `Could not reach device (${cause})` : 'Could not reach device')
  }
  const json = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(json.error ?? `Device responded with HTTP ${response.status}`)
  return json
}

function isTailscaleAddress(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

class SyncService extends EventEmitter<{ status: [] }> {
  private server: Server | null = null
  private serverError: string | null = null
  private pairing: (PairingWindow & { attempts: number }) | null = null
  private pairingTimer: NodeJS.Timeout | null = null
  private seenNonces = new Map<string, number>()
  private syncing = false
  private autoSyncTimer: NodeJS.Timeout | null = null

  status(): SyncStatus {
    const { bindAddress, port } = settingsStore.get().sync
    const running = this.server?.listening ?? false
    const listenAddresses = !running
      ? []
      : bindAddress === '0.0.0.0'
        ? Object.values(networkInterfaces())
            .flat()
            .filter((i) => i && i.family === 'IPv4' && !i.internal)
            .map((i) => i!.address)
            .sort((a, b) => Number(isTailscaleAddress(b)) - Number(isTailscaleAddress(a)))
            .map((address) => `${address}:${port}`)
        : [`${bindAddress}:${port}`]
    return {
      serverRunning: running,
      serverError: this.serverError,
      listenAddresses,
      pairing: this.pairing && { code: this.pairing.code, expiresAt: this.pairing.expiresAt },
      syncing: this.syncing
    }
  }

  /** Starts or stops the server and auto-sync timer to match settings. */
  async reconcile(): Promise<void> {
    const { serverEnabled, bindAddress, port, autoSyncMinutes } = settingsStore.get().sync
    const shouldRun = serverEnabled || this.pairing !== null
    const address = this.server?.address()
    const matches =
      address &&
      typeof address === 'object' &&
      address.port === port &&
      address.address === bindAddress

    if (this.server && (!shouldRun || !matches)) await this.stopServer()
    if (shouldRun && !this.server) await this.startServer(bindAddress, port)

    if (this.autoSyncTimer) clearInterval(this.autoSyncTimer)
    this.autoSyncTimer = null
    if (autoSyncMinutes > 0) {
      this.autoSyncTimer = setInterval(() => {
        if (vault.isUnlocked) void this.syncAll().catch(() => undefined)
      }, autoSyncMinutes * 60_000)
    }
    this.emit('status')
  }

  private startServer(host: string, port: number): Promise<void> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.requestTimeout = REQUEST_TIMEOUT_MS
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.serverError =
          error.code === 'EADDRINUSE' ? `Port ${port} is already in use` : error.message
        this.server = null
        resolve()
      })
      server.listen(port, host, () => {
        this.serverError = null
        this.server = server
        resolve()
      })
    })
  }

  private stopServer(): Promise<void> {
    const server = this.server
    this.server = null
    return new Promise((resolve) => {
      if (!server) return resolve()
      // Let in-flight responses (e.g. a pairing reply) finish; drop idle keep-alive sockets
      server.close(() => resolve())
      server.closeIdleConnections()
    })
  }

  async stop(): Promise<void> {
    if (this.autoSyncTimer) clearInterval(this.autoSyncTimer)
    await this.stopServer()
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/v1/hello') {
        const body: HelloResponse = {
          app: 'pm',
          protocol: PROTOCOL_VERSION,
          deviceName: settingsStore.get().deviceName,
          vaultId: vault.status().vaultId
        }
        return sendJson(res, 200, body)
      }
      if (req.method === 'POST' && url.pathname === '/v1/pair') {
        return sendJson(res, 200, this.handlePair(await readJson<PairRequest>(req)))
      }
      if (req.method === 'POST' && url.pathname === '/v1/sync') {
        return sendJson(res, 200, await this.handleSync(await readJson<SyncRequest>(req)))
      }
      throw new HttpError(404, 'Not found')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Internal error'
      if (!res.headersSent) sendJson(res, status, { error: message })
    }
  }

  private handlePair(body: PairRequest): PairResponse {
    const pairing = this.pairing
    if (!pairing || Date.now() > pairing.expiresAt) {
      throw new HttpError(403, 'Pairing is not active on that device')
    }
    const expected = Buffer.from(pairing.code)
    const given = Buffer.from(String(body.code ?? '').replace(/\D/g, ''))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      pairing.attempts++
      if (pairing.attempts >= MAX_PAIRING_ATTEMPTS) this.stopPairing()
      throw new HttpError(403, 'Incorrect pairing code')
    }
    this.stopPairing()
    return {
      vaultId: vault.vaultId,
      header: vault.keyHeader,
      deviceName: settingsStore.get().deviceName
    }
  }

  private async handleSync(body: SyncRequest): Promise<SyncResponse> {
    if (!vault.isUnlocked) throw new HttpError(423, 'Vault is locked on that device')
    if (body.vaultId !== vault.vaultId)
      throw new HttpError(409, 'That device has a different vault')
    if (typeof body.nonce !== 'string' || body.nonce.length < 16)
      throw new HttpError(400, 'Bad nonce')

    let message: SyncMessage
    try {
      message = openJson<SyncMessage>(vault.key, body.payload, AAD.syncRequest(vault.vaultId))
    } catch (error) {
      if (error instanceof DecryptionError)
        throw new HttpError(401, 'Not authorized for this vault')
      throw error
    }

    const now = Date.now()
    this.pruneNonces(now)
    if (message.nonce !== body.nonce) throw new HttpError(400, 'Nonce mismatch')
    if (Math.abs(now - message.sentAt) > MAX_CLOCK_SKEW_MS) {
      throw new HttpError(400, 'Device clocks differ by more than 5 minutes')
    }
    if (this.seenNonces.has(body.nonce)) throw new HttpError(409, 'Replayed request')
    this.seenNonces.set(body.nonce, now)

    await vault.applyRemote(message.entries, message.header)

    const reply: SyncMessage = this.buildMessage(body.nonce)
    return { payload: sealJson(vault.key, reply, AAD.syncResponse(vault.vaultId, body.nonce)) }
  }

  private pruneNonces(now: number): void {
    for (const [nonce, seenAt] of this.seenNonces) {
      if (now - seenAt > MAX_CLOCK_SKEW_MS * 2) this.seenNonces.delete(nonce)
    }
  }

  private buildMessage(nonce: string): SyncMessage {
    const { deviceId, deviceName } = settingsStore.get()
    return {
      deviceId,
      deviceName,
      sentAt: Date.now(),
      nonce,
      header: vault.keyHeader,
      entries: vault.allRecords()
    }
  }

  async startPairing(): Promise<SyncStatus> {
    if (!vault.isUnlocked) throw new Error('Unlock the vault to pair a device')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.pairing = { code, expiresAt: Date.now() + PAIRING_DURATION_MS, attempts: 0 }
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = setTimeout(() => this.stopPairing(), PAIRING_DURATION_MS)
    await this.reconcile()
    if (!this.server) {
      this.stopPairing()
      throw new Error(this.serverError ?? 'Could not start the sync server')
    }
    return this.status()
  }

  stopPairing(): SyncStatus {
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    this.pairing = null
    void this.reconcile()
    return this.status()
  }

  /** Fetches the vault key header from a device that is in pairing mode. */
  async fetchPairing(host: string, port: number, code: string): Promise<PairResponse> {
    return postJson<PairResponse>(`http://${formatHost(host)}:${port}/v1/pair`, { code })
  }

  async addPeer(input: { name: string; host: string; port: number }): Promise<SyncPeer> {
    const host = input.host.trim()
    if (!host) throw new Error('Enter a host name or IP address')
    const peer: SyncPeer = {
      id: randomUUID(),
      name: input.name.trim() || host,
      host,
      port: input.port,
      lastSyncAt: null,
      lastError: null
    }
    await settingsStore.setPeers((peers) => [
      ...peers.filter((p) => !(p.host === peer.host && p.port === peer.port)),
      peer
    ])
    return peer
  }

  async removePeer(id: string): Promise<void> {
    await settingsStore.setPeers((peers) => peers.filter((p) => p.id !== id))
  }

  async syncAll(peerId?: string): Promise<SyncResult[]> {
    if (!vault.isUnlocked) throw new Error('Unlock the vault to sync')
    if (this.syncing) throw new Error('A sync is already running')
    const peers = settingsStore.get().sync.peers.filter((p) => !peerId || p.id === peerId)
    if (peers.length === 0) throw new Error('Add a device to sync with first')

    this.syncing = true
    this.emit('status')
    try {
      const results: SyncResult[] = []
      for (const peer of peers) results.push(await this.syncPeer(peer))
      return results
    } finally {
      this.syncing = false
      this.emit('status')
    }
  }

  private async syncPeer(peer: SyncPeer): Promise<SyncResult> {
    const nonce = randomBytes(18).toString('base64url')
    const vaultId = vault.vaultId
    const sent = vault.allRecords().length
    try {
      const request: SyncRequest = {
        vaultId,
        nonce,
        payload: sealJson(vault.key, this.buildMessage(nonce), AAD.syncRequest(vaultId))
      }
      const response = await postJson<SyncResponse>(
        `http://${formatHost(peer.host)}:${peer.port}/v1/sync`,
        request
      )
      let message: SyncMessage
      try {
        message = openJson<SyncMessage>(
          vault.key,
          response.payload,
          AAD.syncResponse(vaultId, nonce)
        )
      } catch {
        throw new Error('Device sent an invalid response')
      }
      const received = await vault.applyRemote(message.entries, message.header)
      await this.updatePeer(peer.id, { lastSyncAt: Date.now(), lastError: null })
      return { peerId: peer.id, ok: true, error: null, received, sent }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.updatePeer(peer.id, { lastError: message })
      return { peerId: peer.id, ok: false, error: message, received: 0, sent: 0 }
    }
  }

  private async updatePeer(id: string, patch: Partial<SyncPeer>): Promise<void> {
    await settingsStore.setPeers((peers) =>
      peers.map((p) => (p.id === id ? { ...p, ...patch } : p))
    )
  }
}

export const sync = new SyncService()
