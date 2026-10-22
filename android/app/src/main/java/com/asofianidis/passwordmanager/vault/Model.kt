package com.asofianidis.passwordmanager.vault

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The vault file format shared with the desktop app. See docs/VAULT_FORMAT.md; the reference
 * implementation is src/main/vault/ in the desktop app.
 */
val VaultJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

/**
 * A single stored credential. Deleted entries are kept as tombstones so deletions sync.
 *
 * Property order matters: it matches the key order the desktop app writes, so [canonicalJson]
 * produces the same string as the desktop's `JSON.stringify` for the merge tie-break.
 */
@Serializable
data class VaultEntry(
    val id: String,
    val title: String = "",
    val username: String = "",
    val password: String = "",
    val url: String = "",
    val notes: String = "",
    val totp: String = "",
    val folder: String = "",
    val favorite: Boolean = false,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    val passwordUpdatedAt: Long = 0,
    /** Present (true) only on tombstones */
    val deleted: Boolean? = null,
) {
    val isDeleted: Boolean get() = deleted == true
}

/** The user-editable fields of an entry. */
data class EntryInput(
    val title: String,
    val username: String,
    val password: String,
    val url: String,
    val notes: String,
    val totp: String,
    val folder: String,
    val favorite: Boolean,
) {
    fun sanitized() = EntryInput(
        title = title.trim().ifEmpty { "Untitled" },
        username = username,
        password = password,
        url = url.trim(),
        notes = notes,
        totp = totp.trim(),
        folder = folder.trim(),
        favorite = favorite,
    )

    companion object {
        fun of(entry: VaultEntry) = EntryInput(
            entry.title, entry.username, entry.password, entry.url,
            entry.notes, entry.totp, entry.folder, entry.favorite,
        )
    }
}

@Serializable
data class KdfParams(
    val algorithm: String,
    /** base64 */
    val salt: String,
    val memoryKiB: Int,
    val iterations: Int,
    val parallelism: Int,
)

/** The password-protected vault key. Safe to share with paired devices; it is useless without the master password. */
@Serializable
data class VaultKeyHeader(
    val kdf: KdfParams,
    /** base64 sealed 32-byte vault key, AAD = pm:vault-key:v1:<vaultId> */
    val wrappedKey: String,
    /** When the vault key or master password last changed; the newest header wins during sync */
    val updatedAt: Long,
    /** keyIdOf(vault key). Missing on headers written before key rotation existed. */
    val keyId: String? = null,
    /** Keys this one replaced, so devices still on an old key can catch up. Oldest first. */
    val previousKeys: List<PreviousKey>? = null,
)

/** A retired vault key, sealed with the current vault key. */
@Serializable
data class PreviousKey(
    val keyId: String,
    /** base64 sealed 32-byte key, AAD = pm:prev-key:v1:<vaultId>:<keyId>:<revoked|forward> */
    val wrappedKey: String,
    val revoked: Boolean,
)

@Serializable
data class VaultFile(
    val format: String = "pm-vault",
    val version: Int = 1,
    val vaultId: String,
    /** The header this device last unlocked with. `data` is always sealed with its key. */
    val key: VaultKeyHeader,
    /** A newer header from another device that hasn't unlocked here yet. */
    val pendingKey: VaultKeyHeader? = null,
    /** base64 sealed JSON [VaultPayload], AAD = pm:vault-data:v1:<vaultId> */
    val data: String = "",
    val savedAt: Long = 0,
)

@Serializable
data class VaultPayload(val entries: List<VaultEntry>)
