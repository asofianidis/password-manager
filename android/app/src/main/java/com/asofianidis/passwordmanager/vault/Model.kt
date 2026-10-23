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

/** What an entry holds. Logins have no `type` field on disk. */
enum class EntryType(val wire: String?, val one: String, val many: String) {
    LOGIN(null, "Login", "Logins"),
    CARD("card", "Card", "Cards"),
    IDENTITY("identity", "Photo ID", "Photo IDs"),
    NOTE("note", "Note", "Notes"),
    DOCUMENT("document", "Document", "Documents");

    companion object {
        fun of(wire: String?): EntryType = entries.firstOrNull { it.wire == wire } ?: LOGIN
    }
}

/** Property order is the canonical key order (see [canonicalJson]). */
@Serializable
data class CardDetails(
    val cardholder: String = "",
    /** Digits only */
    val number: String = "",
    /** MM/YY */
    val expiry: String = "",
    val cvv: String = "",
    val pin: String = "",
) {
    fun sanitized() = CardDetails(
        cardholder = cardholder.trim(),
        number = number.filter { it in '0'..'9' },
        expiry = expiry.trim(),
        cvv = cvv.trim(),
        pin = pin.trim(),
    )
}

/** A photo ID. Dates are YYYY-MM-DD, or "" when unknown. */
@Serializable
data class IdentityDetails(
    val kind: String = "passport",
    val fullName: String = "",
    val number: String = "",
    /** Issuing country or state */
    val issuer: String = "",
    val issuedOn: String = "",
    val expiresOn: String = "",
    val birthDate: String = "",
) {
    fun sanitized() = IdentityDetails(
        kind = if (kind in IDENTITY_KINDS) kind else "other",
        fullName = fullName.trim(),
        number = number.trim(),
        issuer = issuer.trim(),
        issuedOn = issuedOn.trim(),
        expiresOn = expiresOn.trim(),
        birthDate = birthDate.trim(),
    )

    companion object {
        val IDENTITY_KINDS = listOf("passport", "drivers-license", "national-id", "other")

        fun kindLabel(kind: String) = when (kind) {
            "passport" -> "Passport"
            "drivers-license" -> "Driver's license"
            "national-id" -> "National ID"
            else -> "ID"
        }
    }
}

/**
 * A file stored outside the vault data, in its own blob sealed with [key]. Attachments never
 * change: replacing a file adds a new attachment with a new id.
 */
@Serializable
data class Attachment(
    val id: String,
    val name: String = "file",
    val mime: String = "application/octet-stream",
    /** Plaintext size in bytes */
    val size: Long = 0,
    /** base64 32-byte AES key for the blob */
    val key: String,
    val createdAt: Long = 0,
) {
    val isImage: Boolean get() = mime.startsWith("image/")

    companion object {
        /** Largest file that can be attached */
        const val MAX_BYTES = 10 * 1024 * 1024
        const val MAX_PER_ENTRY = 20
        private val ID = Regex("^[A-Za-z0-9_-]{8,64}$")

        /** Attachment ids name files on disk, so they must be safe as file names. */
        fun isValidId(id: String) = ID.matches(id)

        /** Drops malformed attachments and duplicates, as cleanAttachments does on desktop. */
        fun clean(list: List<Attachment>): List<Attachment> {
            val seen = HashSet<String>()
            return list.filter { isValidId(it.id) && seen.add(it.id) }.map {
                it.copy(
                    name = it.name.trim().take(255).ifEmpty { "file" },
                    mime = it.mime.trim().take(100).ifEmpty { "application/octet-stream" },
                    size = maxOf(0, it.size),
                )
            }.take(MAX_PER_ENTRY)
        }
    }
}

/**
 * A single stored item. Deleted entries are kept as tombstones so deletions sync.
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
    /** Absent on logins */
    val type: String? = null,
    /** Present only when type is "card" */
    val card: CardDetails? = null,
    /** Present only when type is "identity" */
    val identity: IdentityDetails? = null,
    /** Absent when there are none */
    val attachments: List<Attachment>? = null,
    /** Present (true) only on tombstones */
    val deleted: Boolean? = null,
) {
    val isDeleted: Boolean get() = deleted == true
    val entryType: EntryType get() = EntryType.of(type)
    val isLogin: Boolean get() = type == null

    /** The non-secret second line shown in lists, as entryDetail on desktop. */
    val detail: String get() = when (entryType) {
        EntryType.CARD -> {
            val number = card?.number.orEmpty()
            listOfNotNull(cardBrand(number), if (number.length >= 4) "•••• ${number.takeLast(4)}" else null)
                .joinToString(" ")
        }
        EntryType.IDENTITY -> listOf(IdentityDetails.kindLabel(identity?.kind ?: "other"), identity?.issuer.orEmpty())
            .filter { it.isNotEmpty() }.joinToString(" · ")
        EntryType.NOTE -> notes.lineSequence().firstOrNull { it.isNotBlank() }?.trim()?.take(80).orEmpty()
        EntryType.DOCUMENT -> when (val count = attachments?.size ?: 0) {
            0 -> ""
            1 -> attachments!![0].name
            else -> "$count files"
        }
        EntryType.LOGIN -> username
    }
}

/** Best guess at the card network from the number's prefix. */
fun cardBrand(number: String): String? {
    val n = number.filter { it in '0'..'9' }
    return when {
        n.startsWith("4") -> "Visa"
        Regex("^(5[1-5]|2(2[2-9]|[3-6]\\d|7[01]|720))").containsMatchIn(n) -> "Mastercard"
        Regex("^3[47]").containsMatchIn(n) -> "American Express"
        Regex("^(6011|65|64[4-9])").containsMatchIn(n) -> "Discover"
        Regex("^35(2[89]|[3-8])").containsMatchIn(n) -> "JCB"
        Regex("^3(0[0-5]|[68])").containsMatchIn(n) -> "Diners Club"
        n.startsWith("62") -> "UnionPay"
        else -> null
    }
}

/** Groups card digits the way they're printed: 4-6-5 for Amex, fours otherwise. */
fun formatCardNumber(number: String): String {
    val n = number.filter { it in '0'..'9' }
    if (Regex("^3[47]").containsMatchIn(n)) {
        return listOf(n.take(4), n.drop(4).take(6), n.drop(10)).filter { it.isNotEmpty() }.joinToString(" ")
    }
    return n.chunked(4).joinToString(" ")
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
    val type: EntryType = EntryType.LOGIN,
    val card: CardDetails = CardDetails(),
    val identity: IdentityDetails = IdentityDetails(),
    val attachments: List<Attachment> = emptyList(),
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
        type = type,
        card = card.sanitized(),
        identity = identity.sanitized(),
        attachments = Attachment.clean(attachments),
    )

    /**
     * Builds an entry with keys in the canonical order, leaving out the optional fields that
     * don't apply (composeEntry on desktop). Call on a sanitized input.
     */
    fun compose(id: String, createdAt: Long, updatedAt: Long, passwordUpdatedAt: Long) = VaultEntry(
        id = id,
        title = title,
        username = username,
        password = password,
        url = url,
        notes = notes,
        totp = totp,
        folder = folder,
        favorite = favorite,
        createdAt = createdAt,
        updatedAt = updatedAt,
        passwordUpdatedAt = passwordUpdatedAt,
        type = type.wire,
        card = card.takeIf { type == EntryType.CARD },
        identity = identity.takeIf { type == EntryType.IDENTITY },
        attachments = attachments.ifEmpty { null },
    )

    companion object {
        fun of(entry: VaultEntry) = EntryInput(
            entry.title, entry.username, entry.password, entry.url,
            entry.notes, entry.totp, entry.folder, entry.favorite,
            type = entry.entryType,
            card = entry.card ?: CardDetails(),
            identity = entry.identity ?: IdentityDetails(),
            attachments = entry.attachments.orEmpty(),
        )

        fun empty(type: EntryType = EntryType.LOGIN) = EntryInput("", "", "", "", "", "", "", false, type = type)
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
