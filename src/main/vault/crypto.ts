import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
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

/** Associated-data labels. Any other implementation (e.g. Android) must use the same strings. */
export const AAD = {
  vaultKey: (vaultId: string) => `pm:vault-key:v1:${vaultId}`,
  vaultData: (vaultId: string) => `pm:vault-data:v1:${vaultId}`,
  exportData: 'pm:export:v1',
  syncRequest: (vaultId: string) => `pm:sync-req:v1:${vaultId}`,
  syncResponse: (vaultId: string, nonce: string) => `pm:sync-res:v1:${vaultId}:${nonce}`
}
