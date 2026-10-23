import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/**
 * Client side of the peer-to-peer sync protocol (docs/SYNC_PROTOCOL.md). A phone or tablet
 * can't keep a listener running, so it only ever talks to desktops: it pairs with one, then
 * sends its records and merges what comes back.
 */
public let defaultSyncPort = 47821

public struct HelloResponse: Decodable, Sendable {
    public var app: String
    public var proto: Int
    public var deviceName: String
    public var vaultId: String?

    enum CodingKeys: String, CodingKey {
        case app, proto = "protocol", deviceName, vaultId
    }
}

public struct PairResponse: Decodable, Sendable {
    public var vaultId: String
    public var header: VaultKeyHeader
    public var deviceName: String
}

private struct SealedPayload: Decodable {
    var payload: String
}

struct SyncMessage: Decodable, JSONWritable {
    var deviceId: String
    var deviceName: String
    var sentAt: Int64
    var nonce: String
    var header: VaultKeyHeader
    var entries: [VaultEntry]

    var json: JSON {
        .object([
            ("deviceId", .string(deviceId)), ("deviceName", .string(deviceName)), ("sentAt", .int(sentAt)),
            ("nonce", .string(nonce)), ("header", header.json), ("entries", entries.json),
        ])
    }
}

/** An attachment file's contents: the attachment sealed with its own key, base64 */
struct AttachmentBlob: Decodable, JSONWritable {
    var id: String
    var data: String

    var json: JSON { .object([("id", .string(id)), ("data", .string(data))]) }
}

struct AttachmentResponse: Decodable {
    var attachments: [AttachmentBlob] = []
    /** Wanted ids that can't be sent; wanted ids in neither list were held back for size */
    var missing: [String] = []
    /** Checked ids the desktop lacks */
    var need: [String] = []

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attachments = try c.decodeIfPresent([AttachmentBlob].self, forKey: .attachments) ?? []
        missing = try c.decodeIfPresent([String].self, forKey: .missing) ?? []
        need = try c.decodeIfPresent([String].self, forKey: .need) ?? []
    }

    enum CodingKeys: String, CodingKey { case attachments, missing, need }
}

public enum SyncError: LocalizedError, Equatable {
    /** A peer answered with an error status */
    case peer(status: Int, message: String)
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .peer(_, let message), .failed(let message): return message
        }
    }

    public var status: Int? {
        if case .peer(let status, _) = self { return status }
        return nil
    }
}

public struct SyncOutcome: Sendable {
    public var received: Int
    public var sent: Int
}

public final class SyncClient: @unchecked Sendable {
    private let vault: Vault
    private let deviceId: () -> String
    private let deviceName: () -> String
    private let session: URLSession

    /** Files in one attachment message stop once their total passes this (one file always goes) */
    private static let attachmentBatchBytes = 12 * 1024 * 1024
    private static let maxWant = 1000

    public init(vault: Vault, deviceId: @escaping () -> String, deviceName: @escaping () -> String) {
        self.vault = vault
        self.deviceId = deviceId
        self.deviceName = deviceName
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        // Attachment messages can carry several megabytes
        config.timeoutIntervalForResource = 120
        session = URLSession(configuration: config)
    }

    public func hello(host: String, port: Int) async throws -> HelloResponse {
        try decode(HelloResponse.self, try await request(Self.url(host, port, "/v1/hello"), nil))
    }

    /** Fetches the vault key header from a device that is in pairing mode. */
    public func pair(host: String, port: Int, code: String) async throws -> PairResponse {
        let body = JSON.object([("code", .string(code.filter(\.isASCIIDigit)))]).text
        return try decode(PairResponse.self, try await request(Self.url(host, port, "/v1/pair"), body))
    }

    /** One full sync with a desktop: both sides hold identical records afterwards. */
    public func sync(peerName: String, host: String, port: Int) async throws -> SyncOutcome {
        guard vault.isUnlocked else { throw SyncError.failed("Unlock the vault to sync") }
        let sent = try vault.allRecords().count
        let message: SyncMessage
        do {
            message = try await exchange(host, port, keyId: try vault.keyId, key: try vault.key, entries: nil)
        } catch let error as SyncError where error.status == 401 {
            if try await forwardKey(host, port) {
                throw SyncError.failed(
                    "\(peerName) still has the old master password. It was sent the new key: enter " +
                        "the new master password there to finish."
                )
            }
            if try vault.retiredKeys().isEmpty == false {
                throw SyncError.failed("\(peerName) doesn't have the current vault key. Pair it again.")
            }
            throw error
        }
        let received = try vault.applyRemote(message.entries, header: message.header)
        let ownKeyId = try vault.keyId
        if let peerKeyId = message.header.keyId, peerKeyId != ownKeyId, peerKeyId == vault.pendingKeyId {
            throw SyncError.failed(
                "The master password was changed on \(peerName). Enter the new master password here to keep syncing."
            )
        }
        do {
            try await exchangeAttachments(host, port)
        } catch {
            throw SyncError.failed("Synced entries, but files couldn't be transferred: \(error.localizedDescription)")
        }
        return SyncOutcome(received: received, sent: sent)
    }

    /** Fetches the attachment files this device lacks from a desktop, and sends the ones it lacks. */
    private func exchangeAttachments(_ host: String, _ port: Int) async throws {
        let ids = Array(vault.attachmentRefs().keys).sorted()
        if ids.isEmpty { return }
        var want = ids.filter { !vault.hasAttachmentBlob($0) }
        let check = ids.filter { vault.hasAttachmentBlob($0) }

        // A desktop that predates attachments answers 404
        guard let first = try await attachmentRound(host, port, want: Array(want.prefix(Self.maxWant)), check: check) else { return }
        var reply: AttachmentResponse? = first
        while let current = reply {
            for blob in current.attachments { vault.storeAttachmentBlob(blob.id, blob.data) }
            let done = Set(current.attachments.map(\.id)).union(current.missing)
            want = want.filter { !done.contains($0) }
            // Stop if the desktop sent nothing, so a misbehaving one can't keep us looping
            reply = !want.isEmpty && !current.attachments.isEmpty
                ? try await attachmentRound(host, port, want: Array(want.prefix(Self.maxWant)))
                : nil
        }

        var batch: [AttachmentBlob] = []
        var size = 0
        for id in first.need {
            guard let data = vault.attachmentBlob(id) else { continue }
            if !batch.isEmpty && size + data.utf8.count > Self.attachmentBatchBytes {
                _ = try await attachmentRound(host, port, put: batch)
                batch = []
                size = 0
            }
            batch.append(AttachmentBlob(id: id, data: data))
            size += data.utf8.count
        }
        if !batch.isEmpty { _ = try await attachmentRound(host, port, put: batch) }
    }

    /** One attachment round trip, sealed with the current vault key. Nil if the desktop doesn't support it. */
    private func attachmentRound(
        _ host: String, _ port: Int, want: [String] = [], check: [String] = [], put: [AttachmentBlob] = []
    ) async throws -> AttachmentResponse? {
        let nonce = PMCrypto.nonce()
        let vaultId = try vault.vaultId
        let key = try vault.key
        let message = JSON.object([
            ("nonce", .string(nonce)), ("sentAt", .int(nowMillis())),
            ("want", .array(want.map { .string($0) })), ("check", .array(check.map { .string($0) })),
            ("put", put.json),
        ])
        let payload = try PMCrypto.sealString(key, message.text, aad: Aad.attachmentRequest(vaultId))
        let body = JSON.object([
            ("vaultId", .string(vaultId)), ("keyId", .string(try vault.keyId)), ("nonce", .string(nonce)),
            ("payload", .string(payload)),
        ]).text
        let text: String
        do {
            text = try await request(Self.url(host, port, "/v1/attachments"), body)
        } catch let error as SyncError where error.status == 404 {
            return nil
        }
        do {
            let sealed = try decode(SealedPayload.self, text)
            return try decode(AttachmentResponse.self, try PMCrypto.openString(key, sealed.payload, aad: Aad.attachmentResponse(vaultId, nonce)))
        } catch {
            throw SyncError.failed("Device sent an invalid response")
        }
    }

    /** One request/response round trip, sealed with the given vault key. */
    private func exchange(_ host: String, _ port: Int, keyId: String, key: [UInt8], entries: [VaultEntry]?) async throws -> SyncMessage {
        let nonce = PMCrypto.nonce()
        let vaultId = try vault.vaultId
        let message = SyncMessage(
            deviceId: deviceId(),
            deviceName: deviceName(),
            sentAt: nowMillis(),
            nonce: nonce,
            header: try vault.keyHeader,
            entries: try entries ?? vault.allRecords()
        )
        let payload = try PMCrypto.sealString(key, message.json.text, aad: Aad.syncRequest(vaultId))
        let body = JSON.object([
            ("vaultId", .string(vaultId)), ("keyId", .string(keyId)), ("nonce", .string(nonce)),
            ("payload", .string(payload)),
        ]).text
        let text = try await request(Self.url(host, port, "/v1/sync"), body)
        do {
            let sealed = try decode(SealedPayload.self, text)
            return try decode(SyncMessage.self, try PMCrypto.openString(key, sealed.payload, aad: Aad.syncResponse(vaultId, nonce)))
        } catch {
            throw SyncError.failed("Device sent an invalid response")
        }
    }

    /**
     * After a master password change, a peer still on the old key can't read our requests. Send
     * it just the new header, sealed with the old key; its reply is ignored.
     */
    private func forwardKey(_ host: String, _ port: Int) async throws -> Bool {
        for retired in try vault.retiredKeys().filter({ !$0.revoked }).prefix(3) {
            do {
                _ = try await exchange(host, port, keyId: retired.keyId, key: retired.key, entries: [])
                return true
            } catch let error as SyncError where error.status == 401 {
                continue
            }
        }
        return false
    }

    private func request(_ url: URL?, _ jsonBody: String?) async throws -> String {
        guard let url else { throw SyncError.failed("That isn't a valid address") }
        var request = URLRequest(url: url)
        if let jsonBody {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(jsonBody.utf8)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw SyncError.failed("Could not reach device (\(error.localizedDescription))")
        }
        let text = String(decoding: data, as: UTF8.self)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) {
            struct ErrorBody: Decodable { var error: String? }
            let message = (try? decode(ErrorBody.self, text))?.error
            throw SyncError.peer(status: status, message: message ?? "Device responded with HTTP \(status)")
        }
        return text
    }

    public static func formatHost(_ host: String) -> String {
        host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    }

    static func url(_ host: String, _ port: Int, _ path: String) -> URL? {
        URL(string: "http://\(formatHost(host.trimmed)):\(port)\(path)")
    }
}
