import type { VaultEntry } from './types'

/**
 * Deterministic last-write-wins merge used by sync. Every device runs the same
 * function on the same inputs and converges on the same result.
 * Ties on updatedAt are broken by comparing serialized content so both sides agree.
 */
export function pickNewer(a: VaultEntry, b: VaultEntry): VaultEntry {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? a : b
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b
}

export interface MergeResult {
  entries: VaultEntry[]
  /** Number of entries in `local` that were added or replaced */
  changed: number
}

export function mergeEntries(local: VaultEntry[], remote: VaultEntry[]): MergeResult {
  const byId = new Map(local.map((entry) => [entry.id, entry]))
  let changed = 0
  for (const incoming of remote) {
    const existing = byId.get(incoming.id)
    if (!existing) {
      byId.set(incoming.id, incoming)
      changed++
      continue
    }
    const winner = pickNewer(existing, incoming)
    if (winner !== existing) {
      byId.set(incoming.id, winner)
      changed++
    }
  }
  return { entries: [...byId.values()], changed }
}

/** Replaces a deleted entry with a tombstone that carries no secrets. */
export function toTombstone(entry: VaultEntry, now: number): VaultEntry {
  return {
    id: entry.id,
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    totp: '',
    folder: '',
    favorite: false,
    createdAt: entry.createdAt,
    updatedAt: now,
    passwordUpdatedAt: entry.passwordUpdatedAt,
    deleted: true
  }
}
