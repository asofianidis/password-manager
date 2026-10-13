import { app } from 'electron'
import { EventEmitter } from 'events'
import { randomBytes, randomUUID } from 'crypto'
import { join } from 'path'
import type { EntryInput, VaultEntry, VaultStatus } from '../../shared/types'
import { mergeEntries, toTombstone } from '../../shared/merge'
import { readFileIfExists, writeFileAtomic } from '../fs-utils'
import {
  AAD,
  DecryptionError,
  deriveKey,
  newKdfParams,
  open,
  openJson,
  seal,
  sealJson
} from './crypto'
import type { KdfParams } from './crypto'

/** The password-protected vault key. Safe to share with paired devices; it is useless without the master password. */
export interface VaultKeyHeader {
  kdf: KdfParams
  /** base64 sealed 32-byte vault key, AAD = pm:vault-key:v1:<vaultId> */
  wrappedKey: string
  /** When the master password was last changed; the newest header wins during sync */
  updatedAt: number
}

export interface VaultFile {
  format: 'pm-vault'
  version: 1
  vaultId: string
  key: VaultKeyHeader
  /** base64 sealed JSON VaultPayload, AAD = pm:vault-data:v1:<vaultId> */
  data: string
  savedAt: number
}

interface VaultPayload {
  entries: VaultEntry[]
}

interface Session {
  key: Buffer
  entries: Map<string, VaultEntry>
}

export const MIN_MASTER_PASSWORD_LENGTH = 10

export class IncorrectPasswordError extends Error {
  constructor() {
    super('Incorrect master password')
  }
}

function sanitizeInput(input: EntryInput): EntryInput {
  return {
    title: String(input.title ?? '').trim() || 'Untitled',
    username: String(input.username ?? ''),
    password: String(input.password ?? ''),
    url: String(input.url ?? '').trim(),
    notes: String(input.notes ?? ''),
    totp: String(input.totp ?? '').trim(),
    folder: String(input.folder ?? '').trim(),
    favorite: Boolean(input.favorite)
  }
}

class VaultService extends EventEmitter<{ locked: []; changed: [] }> {
  private file: VaultFile | null = null
  private session: Session | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  get path(): string {
    return join(app.getPath('userData'), 'vault.json')
  }

  async init(): Promise<void> {
    const raw = await readFileIfExists(this.path)
    this.file = raw ? (JSON.parse(raw) as VaultFile) : null
    if (this.file && this.file.format !== 'pm-vault') throw new Error('Unrecognized vault file')
  }

  status(): VaultStatus {
    return {
      state: !this.file ? 'no-vault' : this.session ? 'unlocked' : 'locked',
      vaultId: this.file?.vaultId ?? null
    }
  }

  get isUnlocked(): boolean {
    return this.session !== null
  }

  get vaultId(): string {
    if (!this.file) throw new Error('No vault exists yet')
    return this.file.vaultId
  }

  get keyHeader(): VaultKeyHeader {
    if (!this.file) throw new Error('No vault exists yet')
    return this.file.key
  }

  /** The vault key, for sync encryption. Only available while unlocked. */
  get key(): Buffer {
    return this.requireSession().key
  }

  async create(masterPassword: string): Promise<VaultStatus> {
    if (this.file) throw new Error('A vault already exists')
    assertMasterPassword(masterPassword)
    const vaultId = randomUUID()
    const key = randomBytes(32)
    const header = await wrapKey(key, masterPassword, vaultId)
    this.session = { key, entries: new Map() }
    this.file = { format: 'pm-vault', version: 1, vaultId, key: header, data: '', savedAt: 0 }
    await this.persist()
    return this.status()
  }

  /** Sets up this device with a vault key header fetched from a paired device. */
  async join(
    vaultId: string,
    header: VaultKeyHeader,
    masterPassword: string
  ): Promise<VaultStatus> {
    if (this.file) throw new Error('A vault already exists on this device')
    const key = await unwrapKey(header, masterPassword, vaultId)
    this.session = { key, entries: new Map() }
    this.file = { format: 'pm-vault', version: 1, vaultId, key: header, data: '', savedAt: 0 }
    await this.persist()
    return this.status()
  }

  async unlock(masterPassword: string): Promise<VaultStatus> {
    if (!this.file) throw new Error('No vault exists yet')
    if (this.session) return this.status()
    const key = await unwrapKey(this.file.key, masterPassword, this.file.vaultId)
    const payload = this.file.data
      ? openJson<VaultPayload>(key, this.file.data, AAD.vaultData(this.file.vaultId))
      : { entries: [] }
    this.session = { key, entries: new Map(payload.entries.map((e) => [e.id, e])) }
    return this.status()
  }

  lock(): VaultStatus {
    if (this.session) {
      this.session.key.fill(0)
      this.session.entries.clear()
      this.session = null
      this.emit('locked')
    }
    return this.status()
  }

  async changeMasterPassword(current: string, next: string): Promise<void> {
    const session = this.requireSession()
    assertMasterPassword(next)
    // Verifies the current password before re-wrapping
    const verified = await unwrapKey(this.keyHeader, current, this.vaultId)
    verified.fill(0)
    this.file!.key = await wrapKey(session.key, next, this.vaultId)
    await this.persist()
  }

  /** Verifies a master password without changing state. */
  async verifyMasterPassword(password: string): Promise<boolean> {
    try {
      const key = await unwrapKey(this.keyHeader, password, this.vaultId)
      key.fill(0)
      return true
    } catch (error) {
      if (error instanceof IncorrectPasswordError) return false
      throw error
    }
  }

  /** Live entries (no tombstones). */
  list(): VaultEntry[] {
    return [...this.requireSession().entries.values()].filter((e) => !e.deleted)
  }

  /** All entries including tombstones, for sync. */
  allRecords(): VaultEntry[] {
    return [...this.requireSession().entries.values()]
  }

  get(id: string): VaultEntry {
    const entry = this.requireSession().entries.get(id)
    if (!entry || entry.deleted) throw new Error('Entry not found')
    return entry
  }

  async createEntry(input: EntryInput): Promise<VaultEntry> {
    const [entry] = await this.createEntries([input])
    return entry
  }

  async createEntries(
    inputs: (EntryInput & { createdAt?: number; updatedAt?: number })[]
  ): Promise<VaultEntry[]> {
    const session = this.requireSession()
    const now = Date.now()
    const created = inputs.map((input): VaultEntry => {
      const createdAt = input.createdAt ?? now
      return {
        id: randomUUID(),
        ...sanitizeInput(input),
        createdAt,
        updatedAt: now,
        passwordUpdatedAt: input.updatedAt ?? createdAt
      }
    })
    for (const entry of created) session.entries.set(entry.id, entry)
    await this.commit()
    return created
  }

  async updateEntry(id: string, input: EntryInput): Promise<VaultEntry> {
    const session = this.requireSession()
    const existing = this.get(id)
    const clean = sanitizeInput(input)
    const now = Date.now()
    const updated: VaultEntry = {
      ...existing,
      ...clean,
      updatedAt: Math.max(now, existing.updatedAt + 1),
      passwordUpdatedAt: clean.password !== existing.password ? now : existing.passwordUpdatedAt
    }
    session.entries.set(id, updated)
    await this.commit()
    return updated
  }

  async deleteEntry(id: string): Promise<void> {
    const session = this.requireSession()
    const existing = this.get(id)
    session.entries.set(id, toTombstone(existing, Math.max(Date.now(), existing.updatedAt + 1)))
    await this.commit()
  }

  /** Merges records and an optional newer key header from a peer. Returns how many local records changed. */
  async applyRemote(records: VaultEntry[], header?: VaultKeyHeader): Promise<number> {
    const session = this.requireSession()
    const { entries, changed } = mergeEntries([...session.entries.values()], records)
    let headerChanged = false
    if (header && header.updatedAt > this.keyHeader.updatedAt) {
      if (isValidHeader(header)) {
        this.file!.key = header
        headerChanged = true
      }
    }
    if (changed === 0 && !headerChanged) return 0
    session.entries = new Map(entries.map((e) => [e.id, e]))
    await this.commit()
    return changed
  }

  private requireSession(): Session {
    if (!this.session) throw new Error('Vault is locked')
    return this.session
  }

  private async commit(): Promise<void> {
    await this.persist()
    this.emit('changed')
  }

  /** Serializes writes so concurrent edits and syncs can't interleave on disk. */
  private persist(): Promise<void> {
    const run = async (): Promise<void> => {
      const session = this.requireSession()
      const file = this.file!
      const payload: VaultPayload = { entries: [...session.entries.values()] }
      file.data = sealJson(session.key, payload, AAD.vaultData(file.vaultId))
      file.savedAt = Date.now()
      await writeFileAtomic(this.path, JSON.stringify(file))
    }
    this.writeQueue = this.writeQueue.then(run, run)
    return this.writeQueue
  }
}

function assertMasterPassword(password: string): void {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(`Master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`)
  }
}

async function wrapKey(key: Buffer, password: string, vaultId: string): Promise<VaultKeyHeader> {
  const kdf = newKdfParams()
  const kek = await deriveKey(password, kdf)
  try {
    return { kdf, wrappedKey: seal(kek, key, AAD.vaultKey(vaultId)), updatedAt: Date.now() }
  } finally {
    kek.fill(0)
  }
}

async function unwrapKey(
  header: VaultKeyHeader,
  password: string,
  vaultId: string
): Promise<Buffer> {
  const kek = await deriveKey(password, header.kdf)
  try {
    return open(kek, header.wrappedKey, AAD.vaultKey(vaultId))
  } catch (error) {
    if (error instanceof DecryptionError) throw new IncorrectPasswordError()
    throw error
  } finally {
    kek.fill(0)
  }
}

/**
 * A synced header can't be unwrapped without the new master password, so we only check it is
 * well-formed. It arrived over the sync channel, which is already authenticated with the vault key.
 */
function isValidHeader(header: VaultKeyHeader): boolean {
  const kdf = header.kdf
  return (
    kdf?.algorithm === 'argon2id' &&
    typeof kdf.salt === 'string' &&
    kdf.memoryKiB >= 19 * 1024 &&
    kdf.iterations >= 2 &&
    kdf.parallelism >= 1 &&
    typeof header.wrappedKey === 'string' &&
    Buffer.from(header.wrappedKey, 'base64').length === 12 + 32 + 16
  )
}

export const vault = new VaultService()
