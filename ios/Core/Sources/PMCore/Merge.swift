/**
 * Deterministic last-write-wins merge used by sync, identical to src/shared/merge.ts. Every
 * device runs the same function on the same inputs and converges on the same result.
 */
public func pickNewer(_ a: VaultEntry, _ b: VaultEntry) -> VaultEntry {
    if a.updatedAt != b.updatedAt { return a.updatedAt > b.updatedAt ? a : b }
    if a.isDeleted != b.isDeleted { return a.isDeleted ? a : b }
    // JS compares strings by UTF-16 code units; Swift's own String ordering differs
    return canonicalJson(a).utf16.lexicographicallyPrecedes(canonicalJson(b).utf16) ? b : a
}

struct MergeResult {
    var entries: [VaultEntry]
    var changed: Int
}

/** Merges `remote` into `local`, keeping local order and appending new records. */
func mergeEntries(_ local: [VaultEntry], _ remote: [VaultEntry]) -> MergeResult {
    var entries = local
    var index = [String: Int]()
    for (i, entry) in entries.enumerated() { index[entry.id] = i }
    var changed = 0
    for incoming in remote {
        guard let i = index[incoming.id] else {
            index[incoming.id] = entries.count
            entries.append(incoming)
            changed += 1
            continue
        }
        let winner = pickNewer(entries[i], incoming)
        if winner != entries[i] {
            entries[i] = winner
            changed += 1
        }
    }
    return MergeResult(entries: entries, changed: changed)
}

/** Replaces a deleted entry with a tombstone that carries no secrets. */
func toTombstone(_ entry: VaultEntry, now: Int64) -> VaultEntry {
    VaultEntry(
        id: entry.id, createdAt: entry.createdAt, updatedAt: now,
        passwordUpdatedAt: entry.passwordUpdatedAt, deleted: true
    )
}

/** The string the desktop's `JSON.stringify(entry)` produces for an entry. */
public func canonicalJson(_ entry: VaultEntry) -> String { entry.json.text }
