package com.asofianidis.passwordmanager.vault

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.util.UUID

enum class VaultState { NO_VAULT, LOCKED, UNLOCKED }

data class VaultStatus(
    val state: VaultState,
    val vaultId: String?,
    /** Another device changed the master password, and it hasn't been entered here yet */
    val pendingKeyChange: Boolean,
    /** Bumped on every change, so observers can refresh */
    val revision: Long,
)

class IncorrectPasswordException : Exception("Incorrect master password")

class RetiredKey(val keyId: String, val key: ByteArray, val revoked: Boolean)

/** A key header opened with the master password (or the vault key itself). */
private class OpenedKey(
    val key: ByteArray,
    val keyId: String,
    /** Retired keys, oldest first */
    val previous: List<RetiredKey>,
) {
    fun wipe() {
        key.fill(0)
        previous.forEach { it.key.fill(0) }
    }
}

private class Session(val opened: OpenedKey, val entries: LinkedHashMap<String, VaultEntry>)

/**
 * The vault on this device: a port of src/main/vault/vault.ts. This phone joins a vault created on
 * the desktop; creating a vault and rotating its key (master password change, revoking devices)
 * happen on the desktop and arrive here through sync.
 */
class Vault(private val file: File, private val clock: () -> Long = System::currentTimeMillis) {
    private var vaultFile: VaultFile? = null
    private var session: Session? = null
    private val _status = MutableStateFlow(VaultStatus(VaultState.NO_VAULT, null, false, 0))
    val status: StateFlow<VaultStatus> = _status.asStateFlow()

    /** Each attachment is a file named by its id, holding the blob sealed with the attachment's key. */
    val attachmentsDir = File(file.parentFile, "attachments")

    /** Attachments added this session that no saved entry refers to yet; spared from cleanup */
    private val staged = HashSet<String>()

    init {
        if (file.exists()) {
            val parsed = VaultJson.decodeFromString(VaultFile.serializer(), file.readText())
            require(parsed.format == "pm-vault") { "Unrecognized vault file" }
            vaultFile = parsed
        }
        publish()
    }

    val isUnlocked: Boolean @Synchronized get() = session != null

    /** Increases each time the vault is unlocked, so per-session state (like auto-lock) can tell sessions apart. */
    @Volatile
    var sessionNumber = 0L
        private set

    val vaultId: String @Synchronized get() = vaultFile?.vaultId ?: error("No vault exists yet")

    val keyHeader: VaultKeyHeader @Synchronized get() = vaultFile?.key ?: error("No vault exists yet")

    /** The vault key, for sync encryption. Only available while unlocked. */
    val key: ByteArray @Synchronized get() = requireSession().opened.key

    val keyId: String @Synchronized get() = requireSession().opened.keyId

    val pendingKeyId: String? @Synchronized get() = vaultFile?.pendingKey?.keyId

    /** Retired keys, newest first. */
    @Synchronized
    fun retiredKeys(): List<RetiredKey> = requireSession().opened.previous.reversed()

    @Synchronized
    fun retiredKey(keyId: String): RetiredKey? = requireSession().opened.previous.find { it.keyId == keyId }

    /**
     * Sets up this device with a key header fetched from a paired device. If this device already
     * has the vault (it was cut off and is pairing again), the header becomes a pending key change
     * and is adopted with the master password.
     */
    @Synchronized
    fun join(vaultId: String, header: VaultKeyHeader, masterPassword: String) {
        if (!isValidHeader(header)) throw IllegalArgumentException("That device sent an invalid key header")
        val existing = vaultFile
        if (existing != null) return rejoin(existing, vaultId, header, masterPassword)
        val opened = openHeader(header, masterPassword, vaultId)
        session = Session(opened, LinkedHashMap())
        sessionNumber++
        vaultFile = VaultFile(vaultId = vaultId, key = header)
        persist()
    }

    private fun rejoin(existing: VaultFile, vaultId: String, header: VaultKeyHeader, masterPassword: String) {
        if (vaultId != existing.vaultId) {
            throw IllegalStateException("That device has a different vault. Remove the vault from this phone first.")
        }
        // The user chose this device and typed its pairing code, so its header beats any other pending one
        if (header.updatedAt > existing.key.updatedAt) {
            vaultFile = existing.copy(pendingKey = header)
            persistFile()
        }
        if (session == null) return unlock(masterPassword)
        if (vaultFile!!.pendingKey != null) return adoptPendingKey(masterPassword)
        if (!verifyMasterPassword(masterPassword)) throw IncorrectPasswordException()
    }

    /**
     * Opens the vault. If another device sent a newer key header, the password is tried on that
     * too, and the header is adopted if it opens.
     */
    @Synchronized
    fun unlock(masterPassword: String) {
        val file = vaultFile ?: error("No vault exists yet")
        if (session != null) return
        val current = try {
            openHeader(file.key, masterPassword, file.vaultId)
        } catch (e: IncorrectPasswordException) {
            null
        }
        // Whatever is wrong with a pending header, it must not stop the current one from working
        val pending = file.pendingKey?.let { runCatching { openHeader(it, masterPassword, file.vaultId) }.getOrNull() }
        if (current == null && pending == null) throw IncorrectPasswordException()

        // `data` is sealed with the current header's key. With only the new password, look for
        // that key among the ones the new header retired.
        val dataKey = current?.key ?: findDataKey(file, pending!!)
        if (dataKey == null) {
            pending!!.wipe()
            throw IllegalStateException(
                "The master password was changed on another device, but this device is too far behind " +
                    "to switch with it alone. Unlock with your previous master password first.",
            )
        }
        val entries = readEntries(file, dataKey)
        sessionNumber++
        if (pending != null) {
            current?.wipe()
            session = Session(pending, entries)
            vaultFile = file.copy(key = file.pendingKey, pendingKey = null)
            // Re-seals the data with the adopted key
            persist()
        } else {
            session = Session(current!!, entries)
            publish()
        }
        collectGarbage()
    }

    /**
     * Opens the vault with the vault key itself (from biometric unlock). Returns false if the key
     * no longer belongs to this vault, e.g. after the master password changed.
     */
    @Synchronized
    fun unlockWithKey(key: ByteArray): Boolean {
        val file = vaultFile ?: return false
        if (session != null) return true
        val keyId = Crypto.keyIdOf(key)
        if (file.key.keyId != null && file.key.keyId != keyId) return false
        val entries = try {
            readEntries(file, key)
        } catch (e: DecryptionException) {
            return false
        }
        session = Session(OpenedKey(key.copyOf(), keyId, openPreviousKeys(file.key, key, file.vaultId)), entries)
        sessionNumber++
        publish()
        collectGarbage()
        return true
    }

    @Synchronized
    fun lock() {
        session?.let {
            it.opened.wipe()
            it.entries.clear()
            session = null
            staged.clear()
            publish()
        }
    }

    /** Removes the vault from this device. Other devices keep their copy. */
    @Synchronized
    fun erase() {
        lock()
        vaultFile = null
        file.delete()
        attachmentsDir.deleteRecursively()
        publish()
    }

    /** Switches to the key header another device sent, using the master password set there. */
    @Synchronized
    fun adoptPendingKey(masterPassword: String) {
        val current = requireSession()
        val file = vaultFile!!
        val pending = file.pendingKey ?: return
        val opened = openHeader(pending, masterPassword, file.vaultId)
        current.opened.wipe()
        session = Session(opened, current.entries)
        vaultFile = file.copy(key = pending, pendingKey = null)
        persist()
    }

    /** Drops a pending header, e.g. one no password opens. A peer may send it again. */
    @Synchronized
    fun discardPendingKey() {
        val file = vaultFile ?: return
        if (file.pendingKey == null) return
        vaultFile = file.copy(pendingKey = null)
        persistFile()
    }

    @Synchronized
    fun verifyMasterPassword(password: String): Boolean = try {
        openHeader(keyHeader, password, vaultId).wipe()
        true
    } catch (e: IncorrectPasswordException) {
        false
    }

    /** Live entries (no tombstones). */
    @Synchronized
    fun list(): List<VaultEntry> = requireSession().entries.values.filter { !it.isDeleted }

    /** Live logins, the only entries autofill offers. */
    @Synchronized
    fun logins(): List<VaultEntry> = list().filter { it.isLogin }

    /** All entries including tombstones, for sync. */
    @Synchronized
    fun allRecords(): List<VaultEntry> = requireSession().entries.values.toList()

    @Synchronized
    fun find(id: String): VaultEntry? = requireSession().entries[id]?.takeIf { !it.isDeleted }

    @Synchronized
    fun get(id: String): VaultEntry = find(id) ?: throw NoSuchElementException("Entry not found")

    @Synchronized
    fun createEntry(input: EntryInput): VaultEntry {
        val s = requireSession()
        val now = clock()
        val entry = input.sanitized().compose(UUID.randomUUID().toString(), now, now, now)
        s.entries[entry.id] = entry
        persist()
        return entry
    }

    @Synchronized
    fun updateEntry(id: String, input: EntryInput): VaultEntry {
        val s = requireSession()
        val existing = get(id)
        val clean = input.sanitized()
        val now = clock()
        val updated = clean.compose(
            id = id,
            createdAt = existing.createdAt,
            updatedAt = maxOf(now, existing.updatedAt + 1),
            passwordUpdatedAt = if (clean.password != existing.password) now else existing.passwordUpdatedAt,
        )
        s.entries[id] = updated
        persist()
        return updated
    }

    @Synchronized
    fun deleteEntry(id: String) {
        val s = requireSession()
        val existing = get(id)
        s.entries[id] = toTombstone(existing, maxOf(clock(), existing.updatedAt + 1))
        persist()
    }

    /**
     * Encrypts a file with a new random key and stores it. It stays unreferenced (and is cleaned
     * up on the next unlock) until an entry saved with it in `attachments` refers to it.
     */
    @Synchronized
    fun addAttachment(name: String, mime: String, data: ByteArray): Attachment {
        requireSession()
        require(data.size <= Attachment.MAX_BYTES) { "Files must be ${Attachment.MAX_BYTES / 1024 / 1024} MB or smaller" }
        val id = UUID.randomUUID().toString()
        val key = Crypto.randomBytes(32)
        val attachment = Attachment(
            id = id,
            name = name.trim().take(255).ifEmpty { "file" },
            mime = mime.trim().take(100).ifEmpty { "application/octet-stream" },
            size = data.size.toLong(),
            key = Crypto.b64encode(key),
            createdAt = clock(),
        )
        try {
            writeAtomic(File(attachmentsDir, id), Crypto.seal(key, data, Aad.attachment(id)))
        } finally {
            key.fill(0)
        }
        staged += id
        return attachment
    }

    /** Decrypts an attachment of a live entry, or returns null if this device doesn't have its file yet. */
    fun readAttachment(entryId: String, attachmentId: String): ByteArray? {
        val attachment = synchronized(this) { get(entryId).attachments?.find { it.id == attachmentId } }
            ?: throw NoSuchElementException("Attachment not found")
        return decryptAttachment(attachment)
    }

    /**
     * Decrypts an attachment, including one added in an editor that isn't saved yet. Returns null
     * if this device doesn't have its file.
     */
    fun decryptAttachment(attachment: Attachment): ByteArray? {
        val blob = attachmentBlob(attachment.id) ?: return null
        return openAttachment(attachment, blob)
    }

    /** Attachments of live entries, by id. Sync transfers only these. */
    @Synchronized
    fun attachmentRefs(): Map<String, Attachment> {
        val refs = LinkedHashMap<String, Attachment>()
        for (entry in list()) entry.attachments?.forEach { refs[it.id] = it }
        return refs
    }

    /** The stored (sealed) blob of an attachment, or null if this device doesn't have it. */
    fun attachmentBlob(id: String): String? {
        if (!Attachment.isValidId(id)) return null
        val f = File(attachmentsDir, id)
        return if (f.exists()) f.readText() else null
    }

    fun hasAttachmentBlob(id: String): Boolean = Attachment.isValidId(id) && File(attachmentsDir, id).exists()

    /**
     * Stores a blob received from a peer, if a live entry refers to it and it opens with that
     * entry's key. Returns whether it was stored.
     */
    fun storeAttachmentBlob(id: String, blob: String): Boolean {
        val attachment = attachmentRefs()[id] ?: return false
        try {
            openAttachment(attachment, blob)
        } catch (e: DecryptionException) {
            return false
        }
        writeAtomic(File(attachmentsDir, id), blob)
        return true
    }

    /** Deletes attachment files that no live entry refers to. */
    @Synchronized
    fun collectGarbage() {
        if (session == null) return
        val refs = attachmentRefs()
        // Temp files from writes in progress don't look like ids
        attachmentsDir.listFiles()?.forEach { f ->
            if (Attachment.isValidId(f.name) && f.name !in refs && f.name !in staged) f.delete()
        }
    }

    /**
     * Merges records from a peer. A newer key header is kept as pending until it unlocks here.
     * Returns how many local records changed.
     */
    @Synchronized
    fun applyRemote(records: List<VaultEntry>, header: VaultKeyHeader?): Int {
        val s = requireSession()
        val (entries, changed) = mergeEntries(s.entries.values, records)
        val headerChanged = header != null && stagePendingKey(header)
        if (changed == 0 && !headerChanged) return 0
        s.entries.clear()
        entries.forEach { s.entries[it.id] = it }
        persist()
        return changed
    }

    private fun stagePendingKey(header: VaultKeyHeader): Boolean {
        val file = vaultFile!!
        val newest = maxOf(file.key.updatedAt, file.pendingKey?.updatedAt ?: 0)
        if (!isValidHeader(header) || header.updatedAt <= newest) return false
        vaultFile = file.copy(pendingKey = header)
        return true
    }

    private fun requireSession(): Session = session ?: throw IllegalStateException("Vault is locked")

    private fun readEntries(file: VaultFile, key: ByteArray): LinkedHashMap<String, VaultEntry> {
        val map = LinkedHashMap<String, VaultEntry>()
        if (file.data.isEmpty()) return map
        val json = Crypto.openString(key, file.data, Aad.vaultData(file.vaultId))
        VaultJson.decodeFromString(VaultPayload.serializer(), json).entries.forEach { map[it.id] = it }
        return map
    }

    /** Re-seals the entries with the session key and writes the file. */
    private fun persist() {
        val s = requireSession()
        val current = vaultFile!!
        val payload = VaultJson.encodeToString(VaultPayload.serializer(), VaultPayload(s.entries.values.toList()))
        vaultFile = current.copy(
            data = Crypto.sealString(s.opened.key, payload, Aad.vaultData(current.vaultId)),
            savedAt = clock(),
        )
        persistFile()
        collectGarbage()
    }

    /** Writes header changes without re-sealing the data, so it also works while locked. */
    private fun persistFile() {
        val text = VaultJson.encodeToString(VaultFile.serializer(), vaultFile!!)
        writeAtomic(file, text)
        publish()
    }

    private fun publish() {
        val f = vaultFile
        _status.value = VaultStatus(
            state = when {
                f == null -> VaultState.NO_VAULT
                session != null -> VaultState.UNLOCKED
                else -> VaultState.LOCKED
            },
            vaultId = f?.vaultId,
            pendingKeyChange = f?.pendingKey != null,
            revision = _status.value.revision + 1,
        )
    }

    companion object {
        /** Old keys kept in a header; a device further behind than this has to pair again. */
        const val MAX_PREVIOUS_KEYS = 32

        /** Unwraps a header's vault key and the keys it retired. */
        private fun openHeader(header: VaultKeyHeader, password: String, vaultId: String): OpenedKey {
            val kek = Crypto.deriveKey(password, header.kdf)
            val key = try {
                Crypto.open(kek, header.wrappedKey, Aad.vaultKey(vaultId))
            } catch (e: DecryptionException) {
                throw IncorrectPasswordException()
            } finally {
                kek.fill(0)
            }
            val keyId = Crypto.keyIdOf(key)
            if (header.keyId != null && header.keyId != keyId) throw IllegalStateException("Key header is inconsistent")
            return OpenedKey(key, keyId, openPreviousKeys(header, key, vaultId))
        }

        private fun openPreviousKeys(header: VaultKeyHeader, key: ByteArray, vaultId: String): List<RetiredKey> =
            header.previousKeys.orEmpty().map { p ->
                val old = Crypto.open(key, p.wrappedKey, Aad.previousKey(vaultId, p.keyId, p.revoked))
                if (Crypto.keyIdOf(old) != p.keyId) throw IllegalStateException("Key header is inconsistent")
                RetiredKey(p.keyId, old, p.revoked)
            }

        /** Finds which of a header's keys, current or retired, the local data is sealed with. */
        private fun findDataKey(file: VaultFile, opened: OpenedKey): ByteArray? {
            if (file.data.isEmpty()) return opened.key
            return (listOf(opened.key) + opened.previous.map { it.key }).firstOrNull { key ->
                runCatching { Crypto.open(key, file.data, Aad.vaultData(file.vaultId)) }.isSuccess
            }
        }

        private fun isSealedKey(value: String): Boolean =
            runCatching { Crypto.b64decode(value).size == 12 + 32 + 16 }.getOrDefault(false)

        /**
         * Checks a header from another device before keeping it: its shape, and that its KDF is
         * no weaker than ours. It is still only kept as pending until it unlocks.
         */
        fun isValidHeader(header: VaultKeyHeader): Boolean {
            val previous = header.previousKeys
            return Crypto.isAcceptableKdf(header.kdf) &&
                isSealedKey(header.wrappedKey) &&
                (header.keyId == null || header.keyId.length <= 64) &&
                (previous == null || (previous.size <= MAX_PREVIOUS_KEYS &&
                    previous.all { it.keyId.length <= 64 && isSealedKey(it.wrappedKey) }))
        }

        private fun openAttachment(attachment: Attachment, blob: String): ByteArray {
            val key = runCatching { Crypto.b64decode(attachment.key) }.getOrNull() ?: throw DecryptionException()
            try {
                return Crypto.open(key, blob, Aad.attachment(attachment.id))
            } finally {
                key.fill(0)
            }
        }

        private fun writeAtomic(target: File, text: String) {
            target.parentFile?.mkdirs()
            val tmp = File(target.parentFile, "${target.name}.tmp")
            tmp.outputStream().use { out ->
                out.write(text.toByteArray(Charsets.UTF_8))
                out.fd.sync()
            }
            if (!tmp.renameTo(target)) {
                target.delete()
                if (!tmp.renameTo(target)) throw java.io.IOException("Could not save the vault")
            }
        }
    }
}
