import Foundation

// The vault file format shared with the desktop app. See docs/VAULT_FORMAT.md; the reference
// implementation is src/main/vault/ in the desktop app. Every type decodes leniently (missing
// fields get defaults, unknown ones are ignored) and encodes through [JSON] in the desktop's
// key order.

/** What an entry holds. Logins have no `type` field on disk. */
public enum EntryType: String, CaseIterable, Identifiable, Sendable {
    case login, card, identity, note, document

    public var id: String { rawValue }

    public var wire: String? { self == .login ? nil : rawValue }

    public var one: String {
        switch self {
        case .login: return "Login"
        case .card: return "Card"
        case .identity: return "Photo ID"
        case .note: return "Note"
        case .document: return "Document"
        }
    }

    public var many: String {
        switch self {
        case .login: return "Logins"
        case .card: return "Cards"
        case .identity: return "Photo IDs"
        case .note: return "Notes"
        case .document: return "Documents"
        }
    }

    public static func of(_ wire: String?) -> EntryType {
        allCases.first { $0.wire == wire } ?? .login
    }
}

private extension KeyedDecodingContainer {
    func value<T: Decodable>(_ key: Key, _ fallback: T) throws -> T {
        try decodeIfPresent(T.self, forKey: key) ?? fallback
    }
}

public struct CardDetails: Codable, Equatable, Sendable, JSONWritable {
    public var cardholder = ""
    /** Digits only */
    public var number = ""
    /** MM/YY */
    public var expiry = ""
    public var cvv = ""
    public var pin = ""

    public init(cardholder: String = "", number: String = "", expiry: String = "", cvv: String = "", pin: String = "") {
        self.cardholder = cardholder
        self.number = number
        self.expiry = expiry
        self.cvv = cvv
        self.pin = pin
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cardholder = try c.value(.cardholder, "")
        number = try c.value(.number, "")
        expiry = try c.value(.expiry, "")
        cvv = try c.value(.cvv, "")
        pin = try c.value(.pin, "")
    }

    func sanitized() -> CardDetails {
        CardDetails(
            cardholder: cardholder.trimmed,
            number: number.filter(\.isASCIIDigit),
            expiry: expiry.trimmed,
            cvv: cvv.trimmed,
            pin: pin.trimmed
        )
    }

    var json: JSON {
        .object([
            ("cardholder", .string(cardholder)), ("number", .string(number)), ("expiry", .string(expiry)),
            ("cvv", .string(cvv)), ("pin", .string(pin)),
        ])
    }
}

/** A photo ID. Dates are YYYY-MM-DD, or "" when unknown. */
public struct IdentityDetails: Codable, Equatable, Sendable, JSONWritable {
    public var kind = "passport"
    public var fullName = ""
    public var number = ""
    /** Issuing country or state */
    public var issuer = ""
    public var issuedOn = ""
    public var expiresOn = ""
    public var birthDate = ""

    public static let kinds = ["passport", "drivers-license", "national-id", "other"]

    public static func kindLabel(_ kind: String) -> String {
        switch kind {
        case "passport": return "Passport"
        case "drivers-license": return "Driver's license"
        case "national-id": return "National ID"
        default: return "ID"
        }
    }

    public init(
        kind: String = "passport", fullName: String = "", number: String = "", issuer: String = "",
        issuedOn: String = "", expiresOn: String = "", birthDate: String = ""
    ) {
        self.kind = kind
        self.fullName = fullName
        self.number = number
        self.issuer = issuer
        self.issuedOn = issuedOn
        self.expiresOn = expiresOn
        self.birthDate = birthDate
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.value(.kind, "passport")
        fullName = try c.value(.fullName, "")
        number = try c.value(.number, "")
        issuer = try c.value(.issuer, "")
        issuedOn = try c.value(.issuedOn, "")
        expiresOn = try c.value(.expiresOn, "")
        birthDate = try c.value(.birthDate, "")
    }

    func sanitized() -> IdentityDetails {
        IdentityDetails(
            kind: Self.kinds.contains(kind) ? kind : "other",
            fullName: fullName.trimmed,
            number: number.trimmed,
            issuer: issuer.trimmed,
            issuedOn: issuedOn.trimmed,
            expiresOn: expiresOn.trimmed,
            birthDate: birthDate.trimmed
        )
    }

    var json: JSON {
        .object([
            ("kind", .string(kind)), ("fullName", .string(fullName)), ("number", .string(number)),
            ("issuer", .string(issuer)), ("issuedOn", .string(issuedOn)), ("expiresOn", .string(expiresOn)),
            ("birthDate", .string(birthDate)),
        ])
    }
}

/**
 * A file stored outside the vault data, in its own blob sealed with `key`. Attachments never
 * change: replacing a file adds a new attachment with a new id.
 */
public struct Attachment: Codable, Equatable, Hashable, Identifiable, Sendable, JSONWritable {
    public let id: String
    public var name = "file"
    public var mime = "application/octet-stream"
    /** Plaintext size in bytes */
    public var size: Int64 = 0
    /** base64 32-byte AES key for the blob */
    public let key: String
    public var createdAt: Int64 = 0

    /** Largest file that can be attached */
    public static let maxBytes = 10 * 1024 * 1024
    public static let maxPerEntry = 20

    public var isImage: Bool { mime.hasPrefix("image/") }

    public init(id: String, name: String, mime: String, size: Int64, key: String, createdAt: Int64) {
        self.id = id
        self.name = name
        self.mime = mime
        self.size = size
        self.key = key
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.value(.name, "file")
        mime = try c.value(.mime, "application/octet-stream")
        size = try c.value(.size, 0)
        key = try c.decode(String.self, forKey: .key)
        createdAt = try c.value(.createdAt, 0)
    }

    /** Attachment ids name files on disk, so they must be safe as file names: [A-Za-z0-9_-]{8,64}. */
    public static func isValidId(_ id: String) -> Bool {
        (8...64).contains(id.utf8.count) && id.utf8.allSatisfy { c in
            (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F || c == 0x2D
        }
    }

    /** Drops malformed attachments and duplicates, as cleanAttachments does on desktop. */
    static func clean(_ list: [Attachment]) -> [Attachment] {
        var seen = Set<String>()
        let cleaned = list.filter { isValidId($0.id) && seen.insert($0.id).inserted }.map { a -> Attachment in
            var copy = a
            copy.name = String(a.name.trimmed.prefix(255)).ifEmpty("file")
            copy.mime = String(a.mime.trimmed.prefix(100)).ifEmpty("application/octet-stream")
            copy.size = max(0, a.size)
            return copy
        }
        return Array(cleaned.prefix(maxPerEntry))
    }

    var json: JSON {
        .object([
            ("id", .string(id)), ("name", .string(name)), ("mime", .string(mime)), ("size", .int(size)),
            ("key", .string(key)), ("createdAt", .int(createdAt)),
        ])
    }
}

/**
 * A single stored item. Deleted entries are kept as tombstones so deletions sync.
 *
 * Its [json] has the key order the desktop app writes, so [canonicalJson] produces the same
 * string as the desktop's `JSON.stringify` for the merge tie-break.
 */
public struct VaultEntry: Codable, Equatable, Identifiable, Sendable, JSONWritable {
    public let id: String
    public var title = ""
    public var username = ""
    public var password = ""
    public var url = ""
    public var notes = ""
    public var totp = ""
    public var folder = ""
    public var favorite = false
    public var createdAt: Int64 = 0
    public var updatedAt: Int64 = 0
    public var passwordUpdatedAt: Int64 = 0
    /** Absent on logins */
    public var type: String?
    /** Present only when type is "card" */
    public var card: CardDetails?
    /** Present only when type is "identity" */
    public var identity: IdentityDetails?
    /** Absent when there are none */
    public var attachments: [Attachment]?
    /** Present (true) only on tombstones */
    public var deleted: Bool?

    public init(
        id: String, title: String = "", username: String = "", password: String = "", url: String = "",
        notes: String = "", totp: String = "", folder: String = "", favorite: Bool = false,
        createdAt: Int64 = 0, updatedAt: Int64 = 0, passwordUpdatedAt: Int64 = 0, type: String? = nil,
        card: CardDetails? = nil, identity: IdentityDetails? = nil, attachments: [Attachment]? = nil,
        deleted: Bool? = nil
    ) {
        self.id = id
        self.title = title
        self.username = username
        self.password = password
        self.url = url
        self.notes = notes
        self.totp = totp
        self.folder = folder
        self.favorite = favorite
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.passwordUpdatedAt = passwordUpdatedAt
        self.type = type
        self.card = card
        self.identity = identity
        self.attachments = attachments
        self.deleted = deleted
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.value(.title, "")
        username = try c.value(.username, "")
        password = try c.value(.password, "")
        url = try c.value(.url, "")
        notes = try c.value(.notes, "")
        totp = try c.value(.totp, "")
        folder = try c.value(.folder, "")
        favorite = try c.value(.favorite, false)
        createdAt = try c.value(.createdAt, 0)
        updatedAt = try c.value(.updatedAt, 0)
        passwordUpdatedAt = try c.value(.passwordUpdatedAt, 0)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        card = try c.decodeIfPresent(CardDetails.self, forKey: .card)
        identity = try c.decodeIfPresent(IdentityDetails.self, forKey: .identity)
        attachments = try c.decodeIfPresent([Attachment].self, forKey: .attachments)
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted)
    }

    public var isDeleted: Bool { deleted == true }
    public var entryType: EntryType { EntryType.of(type) }
    public var isLogin: Bool { type == nil }

    /** The non-secret second line shown in lists, as entryDetail on desktop. */
    public var detail: String {
        switch entryType {
        case .card:
            let number = card?.number ?? ""
            return [cardBrand(number), number.count >= 4 ? "•••• \(number.suffix(4))" : nil]
                .compactMap { $0 }.joined(separator: " ")
        case .identity:
            return [IdentityDetails.kindLabel(identity?.kind ?? "other"), identity?.issuer ?? ""]
                .filter { !$0.isEmpty }.joined(separator: " · ")
        case .note:
            let line = notes.split(separator: "\n", omittingEmptySubsequences: false)
                .first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            return line.map { String($0.trimmingCharacters(in: .whitespaces).prefix(80)) } ?? ""
        case .document:
            let list = attachments ?? []
            switch list.count {
            case 0: return ""
            case 1: return list[0].name
            default: return "\(list.count) files"
            }
        case .login:
            return username
        }
    }

    var json: JSON {
        object([
            ("id", .string(id)), ("title", .string(title)), ("username", .string(username)),
            ("password", .string(password)), ("url", .string(url)), ("notes", .string(notes)),
            ("totp", .string(totp)), ("folder", .string(folder)), ("favorite", .bool(favorite)),
            ("createdAt", .int(createdAt)), ("updatedAt", .int(updatedAt)),
            ("passwordUpdatedAt", .int(passwordUpdatedAt)),
            ("type", type.map { .string($0) }), ("card", card?.json), ("identity", identity?.json),
            ("attachments", attachments?.json), ("deleted", deleted.map { .bool($0) }),
        ])
    }
}

/** Best guess at the card network from the number's prefix. */
public func cardBrand(_ number: String) -> String? {
    let n = number.filter(\.isASCIIDigit)
    func matches(_ pattern: String) -> Bool { n.range(of: pattern, options: .regularExpression) != nil }
    if n.hasPrefix("4") { return "Visa" }
    if matches("^(5[1-5]|2(2[2-9]|[3-6][0-9]|7[01]|720))") { return "Mastercard" }
    if matches("^3[47]") { return "American Express" }
    if matches("^(6011|65|64[4-9])") { return "Discover" }
    if matches("^35(2[89]|[3-8])") { return "JCB" }
    if matches("^3(0[0-5]|[68])") { return "Diners Club" }
    if n.hasPrefix("62") { return "UnionPay" }
    return nil
}

/** Groups card digits the way they're printed: 4-6-5 for Amex, fours otherwise. */
public func formatCardNumber(_ number: String) -> String {
    let n = Array(number.filter(\.isASCIIDigit))
    let groups: [Int]
    if n.count >= 2, n[0] == "3", n[1] == "4" || n[1] == "7" {
        groups = [4, 6, max(0, n.count - 10)]
    } else {
        groups = Array(repeating: 4, count: (n.count + 3) / 4)
    }
    var parts: [String] = []
    var start = 0
    for size in groups where start < n.count {
        let end = min(n.count, start + size)
        parts.append(String(n[start..<end]))
        start = end
    }
    return parts.joined(separator: " ")
}

/** The user-editable fields of an entry. */
public struct EntryInput: Equatable, Sendable {
    public var title = ""
    public var username = ""
    public var password = ""
    public var url = ""
    public var notes = ""
    public var totp = ""
    public var folder = ""
    public var favorite = false
    public var type: EntryType = .login
    public var card = CardDetails()
    public var identity = IdentityDetails()
    public var attachments: [Attachment] = []

    public init(type: EntryType = .login) {
        self.type = type
    }

    public init(_ entry: VaultEntry) {
        title = entry.title
        username = entry.username
        password = entry.password
        url = entry.url
        notes = entry.notes
        totp = entry.totp
        folder = entry.folder
        favorite = entry.favorite
        type = entry.entryType
        card = entry.card ?? CardDetails()
        identity = entry.identity ?? IdentityDetails()
        attachments = entry.attachments ?? []
    }

    func sanitized() -> EntryInput {
        var clean = self
        clean.title = title.trimmed.ifEmpty("Untitled")
        clean.url = url.trimmed
        clean.totp = totp.trimmed
        clean.folder = folder.trimmed
        clean.card = card.sanitized()
        clean.identity = identity.sanitized()
        clean.attachments = Attachment.clean(attachments)
        return clean
    }

    /**
     * Builds an entry, leaving out the optional fields that don't apply (composeEntry on
     * desktop). Call on a sanitized input.
     */
    func compose(id: String, createdAt: Int64, updatedAt: Int64, passwordUpdatedAt: Int64) -> VaultEntry {
        VaultEntry(
            id: id, title: title, username: username, password: password, url: url, notes: notes,
            totp: totp, folder: folder, favorite: favorite, createdAt: createdAt, updatedAt: updatedAt,
            passwordUpdatedAt: passwordUpdatedAt, type: type.wire,
            card: type == .card ? card : nil,
            identity: type == .identity ? identity : nil,
            attachments: attachments.isEmpty ? nil : attachments
        )
    }
}

public struct KdfParams: Codable, Equatable, Sendable, JSONWritable {
    public var algorithm: String
    /** base64 */
    public var salt: String
    public var memoryKiB: Int
    public var iterations: Int
    public var parallelism: Int

    var json: JSON {
        .object([
            ("algorithm", .string(algorithm)), ("salt", .string(salt)), ("memoryKiB", .int(Int64(memoryKiB))),
            ("iterations", .int(Int64(iterations))), ("parallelism", .int(Int64(parallelism))),
        ])
    }
}

/** The password-protected vault key. Safe to share with paired devices; it is useless without the master password. */
public struct VaultKeyHeader: Codable, Equatable, Sendable, JSONWritable {
    public var kdf: KdfParams
    /** base64 sealed 32-byte vault key, AAD = pm:vault-key:v1:<vaultId> */
    public var wrappedKey: String
    /** When the vault key or master password last changed; the newest header wins during sync */
    public var updatedAt: Int64
    /** keyId(of: vault key). Missing on headers written before key rotation existed. */
    public var keyId: String?
    /** Keys this one replaced, so devices still on an old key can catch up. Oldest first. */
    public var previousKeys: [PreviousKey]?

    var json: JSON {
        object([
            ("kdf", kdf.json), ("wrappedKey", .string(wrappedKey)), ("updatedAt", .int(updatedAt)),
            ("keyId", keyId.map { .string($0) }), ("previousKeys", previousKeys?.json),
        ])
    }
}

/** A retired vault key, sealed with the current vault key. */
public struct PreviousKey: Codable, Equatable, Sendable, JSONWritable {
    public var keyId: String
    /** base64 sealed 32-byte key, AAD = pm:prev-key:v1:<vaultId>:<keyId>:<revoked|forward> */
    public var wrappedKey: String
    public var revoked: Bool

    var json: JSON {
        .object([("keyId", .string(keyId)), ("wrappedKey", .string(wrappedKey)), ("revoked", .bool(revoked))])
    }
}

public struct VaultFile: Codable, Equatable, Sendable, JSONWritable {
    public var format = "pm-vault"
    public var version = 1
    public var vaultId: String
    /** The header this device last unlocked with. `data` is always sealed with its key. */
    public var key: VaultKeyHeader
    /** A newer header from another device that hasn't unlocked here yet. */
    public var pendingKey: VaultKeyHeader?
    /** base64 sealed JSON {entries}, AAD = pm:vault-data:v1:<vaultId> */
    public var data = ""
    public var savedAt: Int64 = 0

    init(vaultId: String, key: VaultKeyHeader) {
        self.vaultId = vaultId
        self.key = key
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        format = try c.value(.format, "pm-vault")
        version = try c.value(.version, 1)
        vaultId = try c.decode(String.self, forKey: .vaultId)
        key = try c.decode(VaultKeyHeader.self, forKey: .key)
        pendingKey = try c.decodeIfPresent(VaultKeyHeader.self, forKey: .pendingKey)
        data = try c.value(.data, "")
        savedAt = try c.value(.savedAt, 0)
    }

    var json: JSON {
        object([
            ("format", .string(format)), ("version", .int(Int64(version))), ("vaultId", .string(vaultId)),
            ("key", key.json), ("pendingKey", pendingKey?.json), ("data", .string(data)),
            ("savedAt", .int(savedAt)),
        ])
    }
}

struct VaultPayload: Decodable {
    var entries: [VaultEntry]
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }

    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}

/** Milliseconds since the epoch, the timestamps the vault format uses. */
public func nowMillis() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded(.down)) }
