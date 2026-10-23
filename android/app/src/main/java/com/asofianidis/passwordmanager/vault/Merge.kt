package com.asofianidis.passwordmanager.vault

/**
 * Deterministic last-write-wins merge used by sync, identical to src/shared/merge.ts. Every
 * device runs the same function on the same inputs and converges on the same result.
 */
fun pickNewer(a: VaultEntry, b: VaultEntry): VaultEntry {
    if (a.updatedAt != b.updatedAt) return if (a.updatedAt > b.updatedAt) a else b
    if (a.isDeleted != b.isDeleted) return if (a.isDeleted) a else b
    // JS compares strings by UTF-16 code units, as does Kotlin's compareTo
    return if (canonicalJson(a) >= canonicalJson(b)) a else b
}

data class MergeResult(val entries: List<VaultEntry>, val changed: Int)

fun mergeEntries(local: Collection<VaultEntry>, remote: List<VaultEntry>): MergeResult {
    val byId = LinkedHashMap<String, VaultEntry>()
    for (entry in local) byId[entry.id] = entry
    var changed = 0
    for (incoming in remote) {
        val existing = byId[incoming.id]
        if (existing == null) {
            byId[incoming.id] = incoming
            changed++
            continue
        }
        val winner = pickNewer(existing, incoming)
        if (winner !== existing) {
            byId[incoming.id] = winner
            changed++
        }
    }
    return MergeResult(byId.values.toList(), changed)
}

/** Replaces a deleted entry with a tombstone that carries no secrets. */
fun toTombstone(entry: VaultEntry, now: Long) = VaultEntry(
    id = entry.id,
    createdAt = entry.createdAt,
    updatedAt = now,
    passwordUpdatedAt = entry.passwordUpdatedAt,
    deleted = true,
)

/**
 * The string the desktop's `JSON.stringify(entry)` produces for an entry: keys in the order the
 * desktop writes them, and JavaScript's string escaping.
 */
fun canonicalJson(e: VaultEntry): String = buildString {
    append("{\"id\":").appendJsString(e.id)
    append(",\"title\":").appendJsString(e.title)
    append(",\"username\":").appendJsString(e.username)
    append(",\"password\":").appendJsString(e.password)
    append(",\"url\":").appendJsString(e.url)
    append(",\"notes\":").appendJsString(e.notes)
    append(",\"totp\":").appendJsString(e.totp)
    append(",\"folder\":").appendJsString(e.folder)
    append(",\"favorite\":").append(e.favorite)
    append(",\"createdAt\":").append(e.createdAt)
    append(",\"updatedAt\":").append(e.updatedAt)
    append(",\"passwordUpdatedAt\":").append(e.passwordUpdatedAt)
    if (e.type != null) append(",\"type\":").appendJsString(e.type)
    e.card?.let { c ->
        append(",\"card\":{\"cardholder\":").appendJsString(c.cardholder)
        append(",\"number\":").appendJsString(c.number)
        append(",\"expiry\":").appendJsString(c.expiry)
        append(",\"cvv\":").appendJsString(c.cvv)
        append(",\"pin\":").appendJsString(c.pin)
        append('}')
    }
    e.identity?.let { i ->
        append(",\"identity\":{\"kind\":").appendJsString(i.kind)
        append(",\"fullName\":").appendJsString(i.fullName)
        append(",\"number\":").appendJsString(i.number)
        append(",\"issuer\":").appendJsString(i.issuer)
        append(",\"issuedOn\":").appendJsString(i.issuedOn)
        append(",\"expiresOn\":").appendJsString(i.expiresOn)
        append(",\"birthDate\":").appendJsString(i.birthDate)
        append('}')
    }
    e.attachments?.let { list ->
        append(",\"attachments\":[")
        list.forEachIndexed { index, a ->
            if (index > 0) append(',')
            append("{\"id\":").appendJsString(a.id)
            append(",\"name\":").appendJsString(a.name)
            append(",\"mime\":").appendJsString(a.mime)
            append(",\"size\":").append(a.size)
            append(",\"key\":").appendJsString(a.key)
            append(",\"createdAt\":").append(a.createdAt)
            append('}')
        }
        append(']')
    }
    if (e.deleted != null) append(",\"deleted\":").append(e.deleted)
    append('}')
}

private fun StringBuilder.appendJsString(value: String): StringBuilder {
    append('"')
    var i = 0
    while (i < value.length) {
        val c = value[i]
        when {
            c == '"' -> append("\\\"")
            c == '\\' -> append("\\\\")
            c == '\b' -> append("\\b")
            c == '\u000C' -> append("\\f")
            c == '\n' -> append("\\n")
            c == '\r' -> append("\\r")
            c == '\t' -> append("\\t")
            c < ' ' -> append("\\u").append(String.format("%04x", c.code))
            Character.isHighSurrogate(c) && i + 1 < value.length && Character.isLowSurrogate(value[i + 1]) -> {
                append(c).append(value[i + 1])
                i++
            }
            // Well-formed JSON.stringify escapes lone surrogates
            Character.isSurrogate(c) -> append("\\u").append(String.format("%04x", c.code))
            else -> append(c)
        }
        i++
    }
    append('"')
    return this
}
