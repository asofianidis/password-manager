import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto'
import { argon2id } from 'hash-wasm'

export interface KdfParams {
  algorithm: 'argon2id'
  /** base64 */
  salt: string
  memoryKiB: number
  iterations: number
  parallelism: number
}

/** OWASP-recommended Argon2id settings, tuned to take well under a second on desktop hardware. */
export function newKdfParams(): KdfParams {
  return {
    algorithm: 'argon2id',
    salt: randomBytes(16).toString('base64'),
    memoryKiB: 64 * 1024,
    iterations: 3,
    parallelism: 1
  }
}

/**
 * The weakest KDF settings accepted from another device. A synced header is never allowed to
 * lower the cost of guessing the master password, and the upper bounds stop a broken peer from
 * making unlock hang or run out of memory.
 */
export const KDF_LIMITS = {
  minMemoryKiB: 64 * 1024,
  maxMemoryKiB: 1024 * 1024,
  minIterations: 3,
  maxIterations: 64,
  maxParallelism: 16,
  minSaltBytes: 16
}

export function isAcceptableKdf(kdf: KdfParams | undefined): boolean {
  if (!kdf || kdf.algorithm !== 'argon2id' || typeof kdf.salt !== 'string') return false
  const int = (n: unknown, min: number, max: number): boolean =>
    Number.isInteger(n) && (n as number) >= min && (n as number) <= max
  return (
    Buffer.from(kdf.salt, 'base64').length >= KDF_LIMITS.minSaltBytes &&
    int(kdf.memoryKiB, KDF_LIMITS.minMemoryKiB, KDF_LIMITS.maxMemoryKiB) &&
    int(kdf.iterations, KDF_LIMITS.minIterations, KDF_LIMITS.maxIterations) &&
    int(kdf.parallelism, 1, KDF_LIMITS.maxParallelism)
  )
}

export async function deriveKey(password: string, params: KdfParams): Promise<Buffer> {
  if (params.algorithm !== 'argon2id') throw new Error(`Unsupported KDF: ${params.algorithm}`)
  const hash = await argon2id({
    password: password.normalize('NFKC'),
    salt: Buffer.from(params.salt, 'base64'),
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary'
  })
  return Buffer.from(hash)
}

const IV_LENGTH = 12
const TAG_LENGTH = 16

/**
 * AES-256-GCM. Output is base64(iv || ciphertext || tag).
 * `aad` binds the ciphertext to its purpose so blobs can't be swapped between contexts.
 */
export function seal(key: Buffer, plaintext: Buffer | string, aad: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64')
}

export class DecryptionError extends Error {
  constructor(message = 'Decryption failed') {
    super(message)
    this.name = 'DecryptionError'
  }
}

export function open(key: Buffer, sealed: string, aad: string): Buffer {
  const raw = Buffer.from(sealed, 'base64')
  if (raw.length < IV_LENGTH + TAG_LENGTH) throw new DecryptionError()
  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(raw.length - TAG_LENGTH)
  const body = raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    throw new DecryptionError()
  }
}

export function sealJson(key: Buffer, value: unknown, aad: string): string {
  return seal(key, JSON.stringify(value), aad)
}

export function openJson<T>(key: Buffer, sealed: string, aad: string): T {
  return JSON.parse(open(key, sealed, aad).toString('utf8')) as T
}

/**
 * A short public identifier for a vault key, so devices can tell which key a message is sealed
 * with. It is an HMAC keyed by the vault key, so it reveals nothing about the key itself.
 */
export function keyIdOf(key: Buffer): string {
  return createHmac('sha256', key).update('pm:key-id:v1').digest('base64url').slice(0, 22)
}

/** Associated-data labels. Any other implementation (e.g. Android) must use the same strings. */
export const AAD = {
  vaultKey: (vaultId: string) => `pm:vault-key:v1:${vaultId}`,
  vaultData: (vaultId: string) => `pm:vault-data:v1:${vaultId}`,
  previousKey: (vaultId: string, keyId: string, revoked: boolean) =>
    `pm:prev-key:v1:${vaultId}:${keyId}:${revoked ? 'revoked' : 'forward'}`,
  exportData: 'pm:export:v1',
  syncRequest: (vaultId: string) => `pm:sync-req:v1:${vaultId}`,
  syncResponse: (vaultId: string, nonce: string) => `pm:sync-res:v1:${vaultId}:${nonce}`,
  attachment: (attachmentId: string) => `pm:attachment:v1:${attachmentId}`,
  attachmentRequest: (vaultId: string) => `pm:att-req:v1:${vaultId}`,
  attachmentResponse: (vaultId: string, nonce: string) => `pm:att-res:v1:${vaultId}:${nonce}`
}
