import { describe, expect, it } from 'vitest'
import { mergeEntries, toTombstone } from '../src/shared/merge'
import type { VaultEntry } from '../src/shared/types'

function entry(id: string, updatedAt: number, title = id): VaultEntry {
  return {
    id,
    title,
    username: '',
    password: 'pw',
    url: '',
    notes: '',
    totp: '',
    folder: '',
    favorite: false,
    createdAt: 0,
    updatedAt,
    passwordUpdatedAt: 0
  }
}

describe('mergeEntries', () => {
  it('keeps the newest version of each entry and adds new ones', () => {
    const local = [entry('a', 1, 'old'), entry('b', 5)]
    const remote = [entry('a', 2, 'new'), entry('b', 4), entry('c', 1)]
    const { entries, changed } = mergeEntries(local, remote)
    expect(changed).toBe(2)
    expect(Object.fromEntries(entries.map((e) => [e.id, e.title]))).toEqual({
      a: 'new',
      b: 'b',
      c: 'c'
    })
  })

  it('propagates deletions as tombstones', () => {
    const live = entry('a', 1)
    const tomb = toTombstone(live, 2)
    expect(tomb.password).toBe('')
    expect(mergeEntries([live], [tomb]).entries[0].deleted).toBe(true)
  })

  it('is deterministic on timestamp ties regardless of direction', () => {
    const x = entry('a', 1, 'x')
    const y = entry('a', 1, 'y')
    expect(mergeEntries([x], [y]).entries[0]).toEqual(mergeEntries([y], [x]).entries[0])
  })
})
