import { EventEmitter } from 'events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto'
import type {
  PairingWindow,
  SyncPeer,
  SyncResult,
  SyncStatus,
  VaultEntry
} from '../../shared/types'
import { AAD, DecryptionError, openJson, sealJson } from '../vault/crypto'
import { vault } from '../vault/vault'
import { settingsStore } from '../settings'
import {
  ATTACHMENT_BATCH_BYTES,
  MAX_CHECK,
  MAX_CLOCK_SKEW_MS,
  MAX_PAIRING_ATTEMPTS,
  MAX_WANT,
  PAIRING_DURATION_MS,
  PROTOCOL_VERSION,
  formatHost,
  type AttachmentBlob,
  type AttachmentEnvelope,
  type AttachmentRequest,
  type AttachmentResponse,
  type HelloResponse,
  type PairRequest,
  type PairResponse,
  type SyncMessage,
  type SyncRequest,
  type SyncResponse
} from './protocol'

const MAX_BODY_BYTES = 25 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000
/** Attachment messages can carry several megabytes */
const ATTACHMENT_TIMEOUT_MS = 120_000

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

/** A peer answered with an error status. */
class PeerError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function postJson<T>(url: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code
    // macOS reports a denied Local Network permission as an instant "no route to host"
    if (cause === 'EHOSTUNREACH' && process.platform === 'darwin') {
      throw new Error(
        'Could not reach device (EHOSTUNREACH). If it is on your local network, allow Password ' +
          'Manager in System Settings → Privacy & Security → Local Network'
      )
    }
    throw new Error(cause ? `Could not reach device (${cause})` : 'Could not reach device')
  }
  const json = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw new PeerError(
      response.status,
      json.error ?? `Device responded with HTTP ${response.status}`
    )
  }
  return json
}

const stringList = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, max) : []

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
      server.requestTimeout = ATTACHMENT_TIMEOUT_MS
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
      if (req.method === 'POST' && url.pathname === '/v1/attachments') {
        const body = await readJson<AttachmentEnvelope>(req)
        return sendJson(res, 200, await this.handleAttachments(body))
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

    // Find the key the sender used. Requests without a key id come from older versions of the app
    // and are only tried with the current key.
    const keyId = typeof body.keyId === 'string' ? body.keyId : vault.keyId
    const retired = keyId === vault.keyId ? null : vault.retiredKey(keyId)
    if (keyId !== vault.keyId && !retired) {
      if (keyId === vault.pendingKeyId) {
        throw new HttpError(409, 'That device needs the new master password entered first')
      }
      throw new HttpError(401, 'Not authorized for this vault')
    }
    const key = retired?.key ?? vault.key

    let message: SyncMessage
    try {
      message = openJson<SyncMessage>(key, body.payload, AAD.syncRequest(vault.vaultId))
    } catch (error) {
      if (error instanceof DecryptionError)
        throw new HttpError(401, 'Not authorized for this vault')
      throw error
    }

    this.checkFresh(body.nonce, message)

    if (retired) {
      if (retired.revoked) {
        throw new HttpError(403, 'This device was removed from the vault. Pair it again.')
      }
      // The sender is on a key we retired when the master password changed. Anyone with an old
      // copy of the vault holds that key too, so don't trust its entries or send ours. Send only
      // the new header, which opens with the new master password.
      const reply = this.buildMessage(body.nonce, [])
      return { payload: sealJson(key, reply, AAD.syncResponse(vault.vaultId, body.nonce)) }
    }

    await vault.applyRemote(message.entries, message.header)

    const reply: SyncMessage = this.buildMessage(body.nonce)
    return { payload: sealJson(key, reply, AAD.syncResponse(vault.vaultId, body.nonce)) }
  }

  /**
   * Exchanges attachment files with a client that just synced. Only files that live entries refer
   * to are sent, accepted, or asked for, and only with the current key: a device on an old key
   * gets no entries, so it has nothing to ask for.
   */
  private async handleAttachments(body: AttachmentEnvelope): Promise<{ payload: string }> {
    if (!vault.isUnlocked) throw new HttpError(423, 'Vault is locked on that device')
    if (body.vaultId !== vault.vaultId)
      throw new HttpError(409, 'That device has a different vault')
    if (typeof body.nonce !== 'string' || body.nonce.length < 16)
      throw new HttpError(400, 'Bad nonce')
    if (body.keyId !== vault.keyId) throw new HttpError(401, 'Not authorized for this vault')

    let request: AttachmentRequest
    try {
      request = openJson<AttachmentRequest>(
        vault.key,
        body.payload,
        AAD.attachmentRequest(vault.vaultId)
      )
    } catch (error) {
      if (error instanceof DecryptionError)
        throw new HttpError(401, 'Not authorized for this vault')
      throw error
    }
    this.checkFresh(body.nonce, request)

    const want = stringList(request.want, MAX_WANT)
    const check = stringList(request.check, MAX_CHECK)
    const put = Array.isArray(request.put) ? request.put : []

    for (const blob of put) await vault.storeAttachmentBlob(blob?.id, blob?.data)

    const refs = vault.attachmentRefs()
    const reply: AttachmentResponse = { attachments: [], missing: [], need: [] }
    let size = 0
    for (const id of want) {
      const data = refs.has(id) ? await vault.attachmentBlob(id) : null
      if (data === null) {
        reply.missing.push(id)
        continue
      }
      if (reply.attachments.length > 0 && size + data.length > ATTACHMENT_BATCH_BYTES) continue
      reply.attachments.push({ id, data })
      size += data.length
    }
    for (const id of check) {
      if (refs.has(id) && !(await vault.hasAttachmentBlob(id))) reply.need.push(id)
    }
    return {
      payload: sealJson(vault.key, reply, AAD.attachmentResponse(vault.vaultId, body.nonce))
    }
  }

  /** Rejects stale and replayed requests. */
  private checkFresh(nonce: string, message: { nonce: string; sentAt: number }): void {
    const now = Date.now()
    this.pruneNonces(now)
    if (message.nonce !== nonce) throw new HttpError(400, 'Nonce mismatch')
    if (Math.abs(now - message.sentAt) > MAX_CLOCK_SKEW_MS) {
      throw new HttpError(400, 'Device clocks differ by more than 5 minutes')
    }
    if (this.seenNonces.has(nonce)) throw new HttpError(409, 'Replayed request')
    this.seenNonces.set(nonce, now)
  }

  private pruneNonces(now: number): void {
    for (const [nonce, seenAt] of this.seenNonces) {
      if (now - seenAt > MAX_CLOCK_SKEW_MS * 2) this.seenNonces.delete(nonce)
    }
  }

  private buildMessage(nonce: string, entries: VaultEntry[] = vault.allRecords()): SyncMessage {
    const { deviceId, deviceName } = settingsStore.get()
    return { deviceId, deviceName, sentAt: Date.now(), nonce, header: vault.keyHeader, entries }
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
    const sent = vault.allRecords().length
    try {
      let message: SyncMessage
      try {
        message = await this.exchange(peer, vault.keyId, vault.key)
      } catch (error) {
        if (!(error instanceof PeerError && error.status === 401)) throw error
        if (await this.forwardKey(peer)) {
          throw new Error(
            `${peer.name} still has the old master password. It was sent the new key: enter ` +
              'the new master password there to finish.'
          )
        }
        if (vault.retiredKeys().length > 0) {
          throw new Error(`${peer.name} doesn't have the current vault key. Pair it again.`)
        }
        throw error
      }
      const received = await vault.applyRemote(message.entries, message.header)
      const peerKeyId = message.header?.keyId
      if (peerKeyId && peerKeyId !== vault.keyId && peerKeyId === vault.pendingKeyId) {
        throw new Error(
          `The master password was changed on ${peer.name}. Enter the new master password here ` +
            'to keep syncing.'
        )
      }
      try {
        await this.exchangeAttachments(peer)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Synced entries, but files couldn't be transferred: ${reason}`)
      }
      await this.updatePeer(peer.id, { lastSyncAt: Date.now(), lastError: null })
      return { peerId: peer.id, ok: true, error: null, received, sent }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.updatePeer(peer.id, { lastError: message })
      return { peerId: peer.id, ok: false, error: message, received: 0, sent: 0 }
    }
  }

  /** One request/response round trip, sealed with the given vault key. */
  private async exchange(
    peer: SyncPeer,
    keyId: string,
    key: Buffer,
    entries?: VaultEntry[]
  ): Promise<SyncMessage> {
    const nonce = randomBytes(18).toString('base64url')
    const vaultId = vault.vaultId
    const request: SyncRequest = {
      vaultId,
      keyId,
      nonce,
      payload: sealJson(key, this.buildMessage(nonce, entries), AAD.syncRequest(vaultId))
    }
    const response = await postJson<SyncResponse>(
      `http://${formatHost(peer.host)}:${peer.port}/v1/sync`,
      request
    )
    try {
      return openJson<SyncMessage>(key, response.payload, AAD.syncResponse(vaultId, nonce))
    } catch {
      throw new Error('Device sent an invalid response')
    }
  }

  /** Fetches the attachment files this device lacks from a peer, and sends the ones it lacks. */
  private async exchangeAttachments(peer: SyncPeer): Promise<void> {
    const ids = [...vault.attachmentRefs().keys()]
    const have = await Promise.all(ids.map((id) => vault.hasAttachmentBlob(id)))
    let want = ids.filter((_, i) => !have[i])
    const check = ids.filter((_, i) => have[i])
    if (want.length === 0 && check.length === 0) return

    const first = await this.attachmentRound(peer, { want: want.slice(0, MAX_WANT), check })
    if (first === null) return // The peer predates attachments
    for (let reply: AttachmentResponse | null = first; reply;) {
      for (const blob of reply.attachments) await vault.storeAttachmentBlob(blob.id, blob.data)
      const done = new Set([...reply.attachments.map((b) => b.id), ...reply.missing])
      want = want.filter((id) => !done.has(id))
      // Stop if the peer sent nothing, so a misbehaving one can't keep us looping
      reply =
        want.length > 0 && reply.attachments.length > 0
          ? await this.attachmentRound(peer, { want: want.slice(0, MAX_WANT) })
          : null
    }

    let batch: AttachmentBlob[] = []
    let size = 0
    const flush = async (): Promise<void> => {
      if (batch.length > 0) await this.attachmentRound(peer, { put: batch })
      batch = []
      size = 0
    }
    for (const id of first.need) {
      const data = await vault.attachmentBlob(id)
      if (data === null) continue
      if (batch.length > 0 && size + data.length > ATTACHMENT_BATCH_BYTES) await flush()
      batch.push({ id, data })
      size += data.length
    }
    await flush()
  }

  /** One attachment request/response round trip. Returns null if the peer doesn't support it. */
  private async attachmentRound(
    peer: SyncPeer,
    parts: Partial<Pick<AttachmentRequest, 'want' | 'check' | 'put'>>
  ): Promise<AttachmentResponse | null> {
    const nonce = randomBytes(18).toString('base64url')
    const vaultId = vault.vaultId
    const request: AttachmentRequest = {
      nonce,
      sentAt: Date.now(),
      want: parts.want ?? [],
      check: parts.check ?? [],
      put: parts.put ?? []
    }
    const envelope: AttachmentEnvelope = {
      vaultId,
      keyId: vault.keyId,
      nonce,
      payload: sealJson(vault.key, request, AAD.attachmentRequest(vaultId))
    }
    let response: SyncResponse
    try {
      response = await postJson<SyncResponse>(
        `http://${formatHost(peer.host)}:${peer.port}/v1/attachments`,
        envelope,
        ATTACHMENT_TIMEOUT_MS
      )
    } catch (error) {
      if (error instanceof PeerError && error.status === 404) return null
      throw error
    }
    let reply: AttachmentResponse
    try {
      reply = openJson<AttachmentResponse>(
        vault.key,
        response.payload,
        AAD.attachmentResponse(vaultId, nonce)
      )
    } catch {
      throw new Error('Device sent an invalid response')
    }
    return {
      attachments: Array.isArray(reply.attachments) ? reply.attachments : [],
      missing: stringList(reply.missing, MAX_WANT),
      need: stringList(reply.need, MAX_CHECK)
    }
  }

  /**
   * After a master password change, a peer still on the old key can't read our requests. Send it
   * just the new header, sealed with the old key, so it can switch once the new password is
   * entered there. Its reply is ignored, as the old key may be in someone else's hands.
   */
  private async forwardKey(peer: SyncPeer): Promise<boolean> {
    const forwardable = vault.retiredKeys().filter((r) => !r.revoked)
    for (const retired of forwardable.slice(0, 3)) {
      try {
        await this.exchange(peer, retired.keyId, retired.key, [])
        return true
      } catch (error) {
        if (!(error instanceof PeerError && error.status === 401)) throw error
      }
    }
    return false
  }

  private async updatePeer(id: string, patch: Partial<SyncPeer>): Promise<void> {
    await settingsStore.setPeers((peers) =>
      peers.map((p) => (p.id === id ? { ...p, ...patch } : p))
    )
  }
}

export const sync = new SyncService()
