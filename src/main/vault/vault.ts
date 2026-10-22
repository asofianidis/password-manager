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
  isAcceptableKdf,
  keyIdOf,
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
  /** When the vault key or master password last changed; the newest header wins during sync */
  updatedAt: number
  /** keyIdOf(vault key). Missing on headers written before key rotation existed. */
  keyId?: string
  /** Keys this one replaced, so devices still on an old key can catch up. Oldest first. */
  previousKeys?: PreviousKey[]
}

/** A retired vault key, sealed with the current vault key. */
export interface PreviousKey {
  keyId: string
  /** base64 sealed 32-byte key, AAD = pm:prev-key:v1:<vaultId>:<keyId>:<revoked|forward> */
  wrappedKey: string
  /**
   * Devices still on a revoked key are refused outright. Otherwise they are sent the new header,
   * which they can only open with the new master password.
   */
  revoked: boolean
}

export interface VaultFile {
  format: 'pm-vault'
  version: 1
  vaultId: string
  /** The header this device last unlocked with. `data` is always sealed with its key. */
  key: VaultKeyHeader
  /**
   * A newer header received from another device that hasn't unlocked here yet. It replaces `key`
   * only once the master password opens it, so a bad header can't lock this device out.
   */
  pendingKey?: VaultKeyHeader
  /** base64 sealed JSON VaultPayload, AAD = pm:vault-data:v1:<vaultId> */
  data: string
  savedAt: number
}

interface VaultPayload {
  entries: VaultEntry[]
}

interface RetiredKey {
  key: Buffer
  revoked: boolean
}

/** A key header opened with the master password. */
interface OpenedKey {
  key: Buffer
  keyId: string
  previous: Map<string, RetiredKey>
}

interface Session extends OpenedKey {
  entries: Map<string, VaultEntry>
}

/** Old keys kept in a header; a device further behind than this has to pair again. */
const MAX_PREVIOUS_KEYS = 32

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

class VaultService extends EventEmitter<{ locked: []; unlocked: []; changed: [] }> {
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
      vaultId: this.file?.vaultId ?? null,
      pendingKeyChange: Boolean(this.file?.pendingKey)
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

  get keyId(): string {
    return this.requireSession().keyId
  }

  /** The key id of a header from another device that hasn't unlocked here yet. */
  get pendingKeyId(): string | null {
    return this.file?.pendingKey?.keyId ?? null
  }

  /** A key this vault used before, by id. Only available while unlocked. */
  retiredKey(keyId: string): RetiredKey | null {
    return this.requireSession().previous.get(keyId) ?? null
  }

  /** Retired keys, newest first. */
  retiredKeys(): (RetiredKey & { keyId: string })[] {
    return [...this.requireSession().previous]
      .map(([keyId, retired]) => ({ keyId, ...retired }))
      .reverse()
  }

  async create(masterPassword: string): Promise<VaultStatus> {
    if (this.file) throw new Error('A vault already exists')
    assertMasterPassword(masterPassword)
    const vaultId = randomUUID()
    const key = randomBytes(32)
    const header = await wrapKey(key, masterPassword, vaultId, [], Date.now())
    this.session = { key, keyId: keyIdOf(key), previous: new Map(), entries: new Map() }
    this.file = { format: 'pm-vault', version: 1, vaultId, key: header, data: '', savedAt: 0 }
    await this.persist()
    this.emit('unlocked')
    return this.status()
  }

  /**
   * Sets up this device with a vault key header fetched from a paired device. If this device
   * already has the vault (it was cut off and is pairing again), the header becomes a pending
   * key change and is adopted with the master password.
   */
  async join(
    vaultId: string,
    header: VaultKeyHeader,
    masterPassword: string
  ): Promise<VaultStatus> {
    if (!isValidHeader(header)) throw new Error('That device sent an invalid key header')
    if (this.file) return this.rejoin(vaultId, header, masterPassword)
    const opened = await openHeader(header, masterPassword, vaultId)
    this.session = { ...opened, entries: new Map() }
    this.file = { format: 'pm-vault', version: 1, vaultId, key: header, data: '', savedAt: 0 }
    await this.persist()
    this.emit('unlocked')
    return this.status()
  }

  private async rejoin(
    vaultId: string,
    header: VaultKeyHeader,
    masterPassword: string
  ): Promise<VaultStatus> {
    const file = this.file!
    if (vaultId !== file.vaultId) throw new Error('That device has a different vault')
    // The user chose this device and typed its pairing code, so its header beats any other pending one
    if (header.updatedAt > file.key.updatedAt) {
      file.pendingKey = header
      await this.persistFile()
    }
    if (!this.session) return this.unlock(masterPassword)
    if (file.pendingKey) return this.adoptPendingKey(masterPassword)
    if (!(await this.verifyMasterPassword(masterPassword))) throw new IncorrectPasswordError()
    return this.status()
  }

  /**
   * Opens the vault. If another device sent a newer key header, the password is tried on that
   * too, and the header is adopted if it opens. The current header keeps working until then, so
   * a bad header from a peer can't lock this device out.
   */
  async unlock(masterPassword: string): Promise<VaultStatus> {
    if (!this.file) throw new Error('No vault exists yet')
    if (this.session) return this.status()
    const file = this.file
    const current = await openHeader(file.key, masterPassword, file.vaultId).catch(
      (error: unknown) => {
        if (error instanceof IncorrectPasswordError) return null
        throw error
      }
    )
    // Whatever is wrong with a pending header, it must not stop the current one from working
    const pending = file.pendingKey
      ? await openHeader(file.pendingKey, masterPassword, file.vaultId).catch(() => null)
      : null
    if (!current && !pending) throw new IncorrectPasswordError()

    // `data` is sealed with the current header's key. With only the new password, look for that
    // key among the ones the new header retired.
    const dataKey = current?.key ?? findDataKey(file, pending!)
    if (!dataKey) {
      wipe(pending!)
      throw new Error(
        'The master password was changed on another device, but this device is too far behind ' +
          'to switch with it alone. Unlock with your previous master password first.'
      )
    }
    const payload = file.data
      ? openJson<VaultPayload>(dataKey, file.data, AAD.vaultData(file.vaultId))
      : { entries: [] }
    const entries = new Map(payload.entries.map((e) => [e.id, e]))

    if (pending) {
      if (current) wipe(current)
      this.session = { ...pending, entries }
      file.key = file.pendingKey!
      delete file.pendingKey
      // Re-seals the data with the adopted key
      await this.persist()
    } else {
      this.session = { ...current!, entries }
    }
    this.emit('unlocked')
    return this.status()
  }

  lock(): VaultStatus {
    if (this.session) {
      wipe(this.session)
      this.session.entries.clear()
      this.session = null
      this.emit('locked')
    }
    return this.status()
  }

  /**
   * Changes the master password and rotates the vault key, re-encrypting everything with the new
   * key, so an old vault.json or pairing header plus the old password can't read anything saved
   * afterwards. Other devices receive the new header on their next sync and switch over once the
   * new password is entered on them.
   */
  async changeMasterPassword(current: string, next: string): Promise<void> {
    assertMasterPassword(next)
    if (next.normalize('NFKC') === current.normalize('NFKC')) {
      throw new Error('The new master password must be different')
    }
    await this.rotateKey(current, next, false)
  }

  /**
   * Rotates the vault key and keeps the master password, refusing sync from every device still
   * on an older key. This cuts off a lost device; the user's other devices have to pair again.
   */
  async revokeOtherDevices(masterPassword: string): Promise<void> {
    await this.rotateKey(masterPassword, masterPassword, true)
  }

  private async rotateKey(current: string, next: string, revoke: boolean): Promise<void> {
    const session = this.requireSession()
    const file = this.file!
    if (file.pendingKey) {
      throw new Error('The master password was changed on another device. Enter the new one first.')
    }
    if (!(await this.verifyMasterPassword(current))) throw new IncorrectPasswordError()

    const key = randomBytes(32)
    const retired: [string, RetiredKey][] = [
      ...session.previous,
      [session.keyId, { key: session.key, revoked: false }]
    ]
    const previous = new Map(
      retired
        .slice(-MAX_PREVIOUS_KEYS)
        .map(([id, old]) => [id, { key: old.key, revoked: revoke || old.revoked }])
    )
    const previousKeys = [...previous].map(([id, old]): PreviousKey => ({
      keyId: id,
      revoked: old.revoked,
      wrappedKey: seal(key, old.key, AAD.previousKey(file.vaultId, id, old.revoked))
    }))
    const updatedAt = Math.max(Date.now(), file.key.updatedAt + 1)
    file.key = await wrapKey(key, next, file.vaultId, previousKeys, updatedAt)
    session.key = key
    session.keyId = keyIdOf(key)
    session.previous = previous
    // Re-seals all data with the new key
    await this.commit()
  }

  /** Switches to the key header another device sent, using the master password set there. */
  async adoptPendingKey(masterPassword: string): Promise<VaultStatus> {
    const session = this.requireSession()
    const file = this.file!
    const pending = file.pendingKey
    if (!pending) return this.status()
    const opened = await openHeader(pending, masterPassword, file.vaultId)
    wipe(session)
    this.session = { ...opened, entries: session.entries }
    file.key = pending
    delete file.pendingKey
    await this.commit()
    return this.status()
  }

  /** Drops a pending header, e.g. one no password opens. A peer may send it again. */
  async discardPendingKey(): Promise<VaultStatus> {
    if (this.file?.pendingKey) {
      delete this.file.pendingKey
      await this.persistFile()
      this.emit('changed')
    }
    return this.status()
  }

  /** Verifies a master password without changing state. */
  async verifyMasterPassword(password: string): Promise<boolean> {
    try {
      wipe(await openHeader(this.keyHeader, password, this.vaultId))
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

  /**
   * Merges records from a peer. A newer key header is kept as pending until it unlocks here.
   * Returns how many local records changed.
   */
  async applyRemote(records: VaultEntry[], header?: VaultKeyHeader): Promise<number> {
    const session = this.requireSession()
    const { entries, changed } = mergeEntries([...session.entries.values()], records)
    const headerChanged = header ? this.stagePendingKey(header) : false
    if (changed === 0 && !headerChanged) return 0
    session.entries = new Map(entries.map((e) => [e.id, e]))
    await this.commit()
    return changed
  }

  private stagePendingKey(header: VaultKeyHeader): boolean {
    const file = this.file!
    const newest = Math.max(file.key.updatedAt, file.pendingKey?.updatedAt ?? 0)
    if (!isValidHeader(header) || header.updatedAt <= newest) return false
    file.pendingKey = header
    return true
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
    return this.enqueue(async () => {
      const session = this.requireSession()
      const file = this.file!
      const payload: VaultPayload = { entries: [...session.entries.values()] }
      file.data = sealJson(session.key, payload, AAD.vaultData(file.vaultId))
      file.savedAt = Date.now()
      await writeFileAtomic(this.path, JSON.stringify(file))
    })
  }

  /** Writes header changes without re-sealing the data, so it also works while locked. */
  private persistFile(): Promise<void> {
    return this.enqueue(() => writeFileAtomic(this.path, JSON.stringify(this.file)))
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(run, run)
    return this.writeQueue
  }
}

function assertMasterPassword(password: string): void {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(`Master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`)
  }
}

function wipe(opened: OpenedKey): void {
  opened.key.fill(0)
  for (const retired of opened.previous.values()) retired.key.fill(0)
}

async function wrapKey(
  key: Buffer,
  password: string,
  vaultId: string,
  previousKeys: PreviousKey[],
  updatedAt: number
): Promise<VaultKeyHeader> {
  const kdf = newKdfParams()
  const kek = await deriveKey(password, kdf)
  try {
    return {
      kdf,
      wrappedKey: seal(kek, key, AAD.vaultKey(vaultId)),
      updatedAt,
      keyId: keyIdOf(key),
      ...(previousKeys.length > 0 && { previousKeys })
    }
  } finally {
    kek.fill(0)
  }
}

/** Unwraps a header's vault key and the keys it retired. Throws IncorrectPasswordError. */
async function openHeader(
  header: VaultKeyHeader,
  password: string,
  vaultId: string
): Promise<OpenedKey> {
  const kek = await deriveKey(password, header.kdf)
  let key: Buffer
  try {
    key = open(kek, header.wrappedKey, AAD.vaultKey(vaultId))
  } catch (error) {
    if (error instanceof DecryptionError) throw new IncorrectPasswordError()
    throw error
  } finally {
    kek.fill(0)
  }
  const keyId = keyIdOf(key)
  if (header.keyId !== undefined && header.keyId !== keyId) {
    throw new Error('Key header is inconsistent')
  }
  const previous = new Map<string, RetiredKey>()
  for (const p of header.previousKeys ?? []) {
    const old = open(key, p.wrappedKey, AAD.previousKey(vaultId, p.keyId, p.revoked))
    if (keyIdOf(old) !== p.keyId) throw new Error('Key header is inconsistent')
    previous.set(p.keyId, { key: old, revoked: p.revoked })
  }
  return { key, keyId, previous }
}

/** Finds which of a header's keys, current or retired, the local data is sealed with. */
function findDataKey(file: VaultFile, opened: OpenedKey): Buffer | null {
  if (!file.data) return opened.key
  for (const key of [opened.key, ...[...opened.previous.values()].map((r) => r.key)]) {
    try {
      open(key, file.data, AAD.vaultData(file.vaultId))
      return key
    } catch {
      // Not this one
    }
  }
  return null
}

const isSealedKey = (value: unknown): boolean =>
  typeof value === 'string' && Buffer.from(value, 'base64').length === 12 + 32 + 16

/**
 * Checks a header from another device before keeping it. It can't be unwrapped without the
 * master password, so this checks its shape and that its KDF is no weaker than ours. A header
 * that passes is still only kept as pending until it unlocks, so one that never opens is harmless.
 */
function isValidHeader(header: VaultKeyHeader): boolean {
  if (!header || typeof header !== 'object') return false
  const { keyId, previousKeys } = header
  return (
    isAcceptableKdf(header.kdf) &&
    isSealedKey(header.wrappedKey) &&
    Number.isFinite(header.updatedAt) &&
    (keyId === undefined || (typeof keyId === 'string' && keyId.length <= 64)) &&
    (previousKeys === undefined ||
      (Array.isArray(previousKeys) &&
        previousKeys.length <= MAX_PREVIOUS_KEYS &&
        previousKeys.every(
          (p) =>
            typeof p?.keyId === 'string' &&
            p.keyId.length <= 64 &&
            typeof p.revoked === 'boolean' &&
            isSealedKey(p.wrappedKey)
        )))
  )
}

export const vault = new VaultService()
