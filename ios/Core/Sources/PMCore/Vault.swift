import Foundation

public enum VaultState: Sendable {
    case noVault, locked, unlocked
}

public struct VaultStatus: Equatable, Sendable {
    public var state: VaultState
    public var vaultId: String?
    /** Another device changed the master password, and it hasn't been entered here yet */
    public var pendingKeyChange: Bool
    /** Bumped on every change, so observers can refresh */
    public var revision: Int
}

public struct RetiredKey: Sendable {
    public let keyId: String
    public let key: [UInt8]
    public let revoked: Bool
}

/** A key header opened with the master password (or the vault key itself). */
private struct OpenedKey {
    var key: [UInt8]
    var keyId: String
    /** Retired keys, oldest first */
    var previous: [RetiredKey]
}

private final class Session {
    let opened: OpenedKey
    var entries: [VaultEntry]
    var index: [String: Int]

    init(_ opened: OpenedKey, _ entries: [VaultEntry]) {
        self.opened = opened
        self.entries = entries
        index = Dictionary(entries.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { _, last in last })
    }

    subscript(id: String) -> VaultEntry? {
        index[id].map { entries[$0] }
    }

    func put(_ entry: VaultEntry) {
        if let i = index[entry.id] {
            entries[i] = entry
        } else {
            index[entry.id] = entries.count
            entries.append(entry)
        }
    }

    func replaceAll(_ list: [VaultEntry]) {
        entries = list
        index = Dictionary(list.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { _, last in last })
    }
}

/**
 * The vault on this device: a port of src/main/vault/vault.ts (by way of the Android app). This
 * device joins a vault created on the desktop; creating a vault and rotating its key (master
 * password change, revoking devices) happen on the desktop and arrive here through sync.
 *
 * Thread-safe: every method takes the same lock, so the UI, sync, and AutoFill can share one.
 */
public final class Vault: @unchecked Sendable {
    private let file: URL
    private let clock: () -> Int64
    /** Never writes: for the AutoFill extension, which reads the app's vault while the app may be running */
    private let readOnly: Bool
    private let lock = NSRecursiveLock()
    private var vaultFile: VaultFile?
    private var session: Session?
    private var _status = VaultStatus(state: .noVault, vaultId: nil, pendingKeyChange: false, revision: 0)

    /** Called (on whatever thread made the change) whenever the status changes */
    public var onStatusChange: ((VaultStatus) -> Void)?

    /** Each attachment is a file named by its id, holding the blob sealed with the attachment's key. */
    public let attachmentsDir: URL

    /** Attachments added this session that no saved entry refers to yet; spared from cleanup */
    private var staged = Set<String>()

    /** Old keys kept in a header; a device further behind than this has to pair again. */
    public static let maxPreviousKeys = 32

    public init(file: URL, readOnly: Bool = false, clock: @escaping () -> Int64 = nowMillis) throws {
        self.file = file
        self.readOnly = readOnly
        self.clock = clock
        attachmentsDir = file.deletingLastPathComponent().appendingPathComponent("attachments", isDirectory: true)
        if FileManager.default.fileExists(atPath: file.path) {
            let parsed = try JSONDecoder().decode(VaultFile.self, from: Data(contentsOf: file))
            guard parsed.format == "pm-vault" else { throw VaultError.message("Unrecognized vault file") }
            vaultFile = parsed
        }
        publish()
    }

    private func synchronized<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    public var status: VaultStatus { synchronized { _status } }

    public var isUnlocked: Bool { synchronized { session != nil } }

    /** Increases each time the vault is unlocked, so per-session state (like auto-lock) can tell sessions apart. */
    public private(set) var sessionNumber = 0

    public var vaultId: String {
        get throws { try synchronized { guard let f = vaultFile else { throw VaultError.noVault }; return f.vaultId } }
    }

    public var keyHeader: VaultKeyHeader {
        get throws { try synchronized { guard let f = vaultFile else { throw VaultError.noVault }; return f.key } }
    }

    /** The vault key, for sync encryption and biometric unlock. Only available while unlocked. */
    public var key: [UInt8] {
        get throws { try synchronized { try requireSession().opened.key } }
    }

    public var keyId: String {
        get throws { try synchronized { try requireSession().opened.keyId } }
    }

    public var pendingKeyId: String? { synchronized { vaultFile?.pendingKey?.keyId } }

    /** Retired keys, newest first. */
    public func retiredKeys() throws -> [RetiredKey] {
        try synchronized { try requireSession().opened.previous.reversed() }
    }

    /**
     * Sets up this device with a key header fetched from a paired device. If this device already
     * has the vault (it was cut off and is pairing again), the header becomes a pending key change
     * and is adopted with the master password.
     */
    public func join(vaultId: String, header: VaultKeyHeader, masterPassword: String) throws {
        try synchronized {
            guard Self.isValidHeader(header) else { throw VaultError.message("That device sent an invalid key header") }
            if let existing = vaultFile { return try rejoin(existing, vaultId, header, masterPassword) }
            let opened = try Self.openHeader(header, masterPassword, vaultId)
            session = Session(opened, [])
            sessionNumber += 1
            vaultFile = VaultFile(vaultId: vaultId, key: header)
            try persist()
        }
    }

    private func rejoin(_ existing: VaultFile, _ vaultId: String, _ header: VaultKeyHeader, _ masterPassword: String) throws {
        guard vaultId == existing.vaultId else {
            throw VaultError.message("That device has a different vault. Remove the vault from this device first.")
        }
        // The user chose this device and typed its pairing code, so its header beats any other pending one
        if header.updatedAt > existing.key.updatedAt {
            vaultFile?.pendingKey = header
            try persistFile()
        }
        if session == nil { return try unlock(masterPassword) }
        if vaultFile?.pendingKey != nil { return try adoptPendingKey(masterPassword) }
        guard verifyMasterPassword(masterPassword) else { throw VaultError.incorrectPassword }
    }

    /**
     * Opens the vault. If another device sent a newer key header, the password is tried on that
     * too, and the header is adopted if it opens.
     */
    public func unlock(_ masterPassword: String) throws {
        try synchronized {
            guard let file = vaultFile else { throw VaultError.noVault }
            if session != nil { return }
            var current: OpenedKey?
            do {
                current = try Self.openHeader(file.key, masterPassword, file.vaultId)
            } catch VaultError.incorrectPassword {
                current = nil
            }
            // Whatever is wrong with a pending header, it must not stop the current one from working
            let pending = file.pendingKey.flatMap { try? Self.openHeader($0, masterPassword, file.vaultId) }
            if current == nil && pending == nil { throw VaultError.incorrectPassword }

            // `data` is sealed with the current header's key. With only the new password, look for
            // that key among the ones the new header retired.
            guard let dataKey = current?.key ?? Self.findDataKey(file, pending!) else {
                throw VaultError.message(
                    "The master password was changed on another device, but this device is too far behind " +
                        "to switch with it alone. Unlock with your previous master password first."
                )
            }
            let entries = try Self.readEntries(file, dataKey)
            sessionNumber += 1
            if let pending {
                session = Session(pending, entries)
                vaultFile?.key = file.pendingKey!
                vaultFile?.pendingKey = nil
                // Re-seals the data with the adopted key
                try persist()
            } else {
                session = Session(current!, entries)
                publish()
            }
            collectGarbage()
        }
    }

    /**
     * Opens the vault with the vault key itself (from biometric unlock). Returns false if the key
     * no longer belongs to this vault, e.g. after the master password changed.
     */
    public func unlock(withKey key: [UInt8]) -> Bool {
        synchronized {
            guard let file = vaultFile else { return false }
            if session != nil { return true }
            let keyId = PMCrypto.keyId(of: key)
            if let expected = file.key.keyId, expected != keyId { return false }
            guard let entries = try? Self.readEntries(file, key),
                  let previous = try? Self.openPreviousKeys(file.key, key, file.vaultId)
            else { return false }
            session = Session(OpenedKey(key: key, keyId: keyId, previous: previous), entries)
            sessionNumber += 1
            publish()
            collectGarbage()
            return true
        }
    }

    public func lockVault() {
        synchronized {
            guard session != nil else { return }
            session = nil
            staged.removeAll()
            publish()
        }
    }

    /** Removes the vault from this device. Other devices keep their copy. */
    public func erase() {
        synchronized {
            lockVault()
            vaultFile = nil
            try? FileManager.default.removeItem(at: file)
            try? FileManager.default.removeItem(at: attachmentsDir)
            publish()
        }
    }

    /** Switches to the key header another device sent, using the master password set there. */
    public func adoptPendingKey(_ masterPassword: String) throws {
        try synchronized {
            let current = try requireSession()
            guard let file = vaultFile, let pending = file.pendingKey else { return }
            let opened = try Self.openHeader(pending, masterPassword, file.vaultId)
            session = Session(opened, current.entries)
            vaultFile?.key = pending
            vaultFile?.pendingKey = nil
            try persist()
        }
    }

    /** Drops a pending header, e.g. one no password opens. A peer may send it again. */
    public func discardPendingKey() throws {
        try synchronized {
            guard vaultFile?.pendingKey != nil else { return }
            vaultFile?.pendingKey = nil
            try persistFile()
        }
    }

    public func verifyMasterPassword(_ password: String) -> Bool {
        synchronized {
            guard let file = vaultFile else { return false }
            return (try? Self.openHeader(file.key, password, file.vaultId)) != nil
        }
    }

    /** Live entries (no tombstones). */
    public func list() throws -> [VaultEntry] {
        try synchronized { try requireSession().entries.filter { !$0.isDeleted } }
    }

    /** Live logins, the only entries AutoFill offers. */
    public func logins() throws -> [VaultEntry] {
        try list().filter(\.isLogin)
    }

    /** All entries including tombstones, for sync. */
    public func allRecords() throws -> [VaultEntry] {
        try synchronized { try requireSession().entries }
    }

    public func find(_ id: String) -> VaultEntry? {
        synchronized { session?[id].flatMap { $0.isDeleted ? nil : $0 } }
    }

    public func get(_ id: String) throws -> VaultEntry {
        guard let entry = find(id) else { throw VaultError.notFound }
        return entry
    }

    @discardableResult
    public func createEntry(_ input: EntryInput) throws -> VaultEntry {
        try synchronized {
            let s = try requireSession()
            let now = clock()
            let entry = input.sanitized().compose(id: UUID().uuidString.lowercased(), createdAt: now, updatedAt: now, passwordUpdatedAt: now)
            s.put(entry)
            try persist()
            return entry
        }
    }

    @discardableResult
    public func updateEntry(_ id: String, _ input: EntryInput) throws -> VaultEntry {
        try synchronized {
            let s = try requireSession()
            let existing = try get(id)
            let clean = input.sanitized()
            let now = clock()
            let updated = clean.compose(
                id: id,
                createdAt: existing.createdAt,
                updatedAt: max(now, existing.updatedAt + 1),
                passwordUpdatedAt: clean.password != existing.password ? now : existing.passwordUpdatedAt
            )
            s.put(updated)
            try persist()
            return updated
        }
    }

    public func deleteEntry(_ id: String) throws {
        try synchronized {
            let s = try requireSession()
            let existing = try get(id)
            s.put(toTombstone(existing, now: max(clock(), existing.updatedAt + 1)))
            try persist()
        }
    }

    /**
     * Encrypts a file with a new random key and stores it. It stays unreferenced (and is cleaned
     * up on the next unlock) until an entry saved with it in `attachments` refers to it.
     */
    public func addAttachment(name: String, mime: String, data: [UInt8]) throws -> Attachment {
        try synchronized {
            _ = try requireSession()
            guard data.count <= Attachment.maxBytes else {
                throw VaultError.message("Files must be \(Attachment.maxBytes / 1024 / 1024) MB or smaller")
            }
            let id = UUID().uuidString.lowercased()
            var key = PMCrypto.randomBytes(32)
            defer { wipe(&key) }
            let attachment = Attachment(
                id: id,
                name: String(name.trimmed.prefix(255)).ifEmpty("file"),
                mime: String(mime.trimmed.prefix(100)).ifEmpty("application/octet-stream"),
                size: Int64(data.count),
                key: PMCrypto.b64encode(key),
                createdAt: clock()
            )
            try Self.writeAtomic(attachmentsDir.appendingPathComponent(id), PMCrypto.seal(key, data, aad: Aad.attachment(id)))
            staged.insert(id)
            return attachment
        }
    }

    /** Decrypts an attachment of a live entry, or returns nil if this device doesn't have its file yet. */
    public func readAttachment(entryId: String, attachmentId: String) throws -> [UInt8]? {
        guard let attachment = try get(entryId).attachments?.first(where: { $0.id == attachmentId }) else {
            throw VaultError.message("Attachment not found")
        }
        return try decryptAttachment(attachment)
    }

    /**
     * Decrypts an attachment, including one added in an editor that isn't saved yet. Returns nil
     * if this device doesn't have its file.
     */
    public func decryptAttachment(_ attachment: Attachment) throws -> [UInt8]? {
        guard let blob = attachmentBlob(attachment.id) else { return nil }
        return try Self.openAttachment(attachment, blob)
    }

    /** Attachments of live entries, by id. Sync transfers only these. */
    public func attachmentRefs() -> [String: Attachment] {
        synchronized {
            var refs = [String: Attachment]()
            for entry in (try? list()) ?? [] {
                for a in entry.attachments ?? [] { refs[a.id] = a }
            }
            return refs
        }
    }

    /** The stored (sealed) blob of an attachment, or nil if this device doesn't have it. */
    public func attachmentBlob(_ id: String) -> String? {
        guard Attachment.isValidId(id) else { return nil }
        return try? String(contentsOf: attachmentsDir.appendingPathComponent(id), encoding: .utf8)
    }

    public func hasAttachmentBlob(_ id: String) -> Bool {
        Attachment.isValidId(id) && FileManager.default.fileExists(atPath: attachmentsDir.appendingPathComponent(id).path)
    }

    /**
     * Stores a blob received from a peer, if a live entry refers to it and it opens with that
     * entry's key. Returns whether it was stored.
     */
    @discardableResult
    public func storeAttachmentBlob(_ id: String, _ blob: String) -> Bool {
        guard !readOnly, let attachment = attachmentRefs()[id], (try? Self.openAttachment(attachment, blob)) != nil else {
            return false
        }
        return (try? Self.writeAtomic(attachmentsDir.appendingPathComponent(id), blob)) != nil
    }

    /** Deletes attachment files that no live entry refers to. */
    public func collectGarbage() {
        synchronized {
            guard session != nil, !readOnly else { return }
            let refs = attachmentRefs()
            let names = (try? FileManager.default.contentsOfDirectory(atPath: attachmentsDir.path)) ?? []
            // Temp files from writes in progress don't look like ids
            for name in names where Attachment.isValidId(name) && refs[name] == nil && !staged.contains(name) {
                try? FileManager.default.removeItem(at: attachmentsDir.appendingPathComponent(name))
            }
        }
    }

    /**
     * Merges records from a peer. A newer key header is kept as pending until it unlocks here.
     * Returns how many local records changed.
     */
    @discardableResult
    public func applyRemote(_ records: [VaultEntry], header: VaultKeyHeader?) throws -> Int {
        try synchronized {
            let s = try requireSession()
            let merged = mergeEntries(s.entries, records)
            let headerChanged = header.map(stagePendingKey) ?? false
            if merged.changed == 0 && !headerChanged { return 0 }
            s.replaceAll(merged.entries)
            try persist()
            return merged.changed
        }
    }

    private func stagePendingKey(_ header: VaultKeyHeader) -> Bool {
        guard let file = vaultFile else { return false }
        let newest = max(file.key.updatedAt, file.pendingKey?.updatedAt ?? 0)
        guard Self.isValidHeader(header), header.updatedAt > newest else { return false }
        vaultFile?.pendingKey = header
        return true
    }

    private func requireSession() throws -> Session {
        guard let session else { throw VaultError.locked }
        return session
    }

    /** Re-seals the entries with the session key and writes the file. */
    private func persist() throws {
        let s = try requireSession()
        guard var current = vaultFile else { throw VaultError.noVault }
        if !readOnly {
            let payload = JSON.object([("entries", s.entries.json)]).text
            current.data = try PMCrypto.sealString(s.opened.key, payload, aad: Aad.vaultData(current.vaultId))
            current.savedAt = clock()
        }
        vaultFile = current
        try persistFile()
        collectGarbage()
    }

    /** Writes header changes without re-sealing the data, so it also works while locked. */
    private func persistFile() throws {
        if !readOnly, let vaultFile { try Self.writeAtomic(file, vaultFile.json.text) }
        publish()
    }

    private func publish() {
        let f = vaultFile
        _status = VaultStatus(
            state: f == nil ? .noVault : session != nil ? .unlocked : .locked,
            vaultId: f?.vaultId,
            pendingKeyChange: f?.pendingKey != nil,
            revision: _status.revision + 1
        )
        onStatusChange?(_status)
    }

    /** Unwraps a header's vault key and the keys it retired. */
    private static func openHeader(_ header: VaultKeyHeader, _ password: String, _ vaultId: String) throws -> OpenedKey {
        var kek = try PMCrypto.deriveKey(password, header.kdf)
        defer { wipe(&kek) }
        let key: [UInt8]
        do {
            key = try PMCrypto.open(kek, header.wrappedKey, aad: Aad.vaultKey(vaultId))
        } catch {
            throw VaultError.incorrectPassword
        }
        let keyId = PMCrypto.keyId(of: key)
        if let expected = header.keyId, expected != keyId { throw VaultError.message("Key header is inconsistent") }
        return OpenedKey(key: key, keyId: keyId, previous: try openPreviousKeys(header, key, vaultId))
    }

    private static func openPreviousKeys(_ header: VaultKeyHeader, _ key: [UInt8], _ vaultId: String) throws -> [RetiredKey] {
        try (header.previousKeys ?? []).map { p in
            let old = try PMCrypto.open(key, p.wrappedKey, aad: Aad.previousKey(vaultId, p.keyId, revoked: p.revoked))
            guard PMCrypto.keyId(of: old) == p.keyId else { throw VaultError.message("Key header is inconsistent") }
            return RetiredKey(keyId: p.keyId, key: old, revoked: p.revoked)
        }
    }

    /** Finds which of a header's keys, current or retired, the local data is sealed with. */
    private static func findDataKey(_ file: VaultFile, _ opened: OpenedKey) -> [UInt8]? {
        if file.data.isEmpty { return opened.key }
        return ([opened.key] + opened.previous.map(\.key)).first { key in
            (try? PMCrypto.open(key, file.data, aad: Aad.vaultData(file.vaultId))) != nil
        }
    }

    private static func readEntries(_ file: VaultFile, _ key: [UInt8]) throws -> [VaultEntry] {
        if file.data.isEmpty { return [] }
        let json = try PMCrypto.openString(key, file.data, aad: Aad.vaultData(file.vaultId))
        // Later duplicates replace earlier ones, as the Android and desktop maps do
        let session = Session(OpenedKey(key: [], keyId: "", previous: []), [])
        for entry in try decode(VaultPayload.self, json).entries { session.put(entry) }
        return session.entries
    }

    private static func isSealedKey(_ value: String) -> Bool {
        PMCrypto.b64decode(value)?.count == 12 + 32 + 16
    }

    /**
     * Checks a header from another device before keeping it: its shape, and that its KDF is
     * no weaker than ours. It is still only kept as pending until it unlocks.
     */
    public static func isValidHeader(_ header: VaultKeyHeader) -> Bool {
        PMCrypto.isAcceptableKdf(header.kdf) &&
            isSealedKey(header.wrappedKey) &&
            (header.keyId?.count ?? 0) <= 64 &&
            (header.previousKeys.map { list in
                list.count <= maxPreviousKeys && list.allSatisfy { $0.keyId.count <= 64 && isSealedKey($0.wrappedKey) }
            } ?? true)
    }

    private static func openAttachment(_ attachment: Attachment, _ blob: String) throws -> [UInt8] {
        guard var key = PMCrypto.b64decode(attachment.key) else { throw VaultError.decryptionFailed }
        defer { wipe(&key) }
        return try PMCrypto.open(key, blob, aad: Aad.attachment(attachment.id))
    }

    static func writeAtomic(_ target: URL, _ text: String) throws {
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS)
        // Unreadable while the device is locked; neither the app nor AutoFill runs then
        options.insert(.completeFileProtection)
        #endif
        try Data(text.utf8).write(to: target, options: options)
    }
}
