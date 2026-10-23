import CArgon2
import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

/** Crypto primitives, byte-compatible with src/main/vault/crypto.ts in the desktop app. */
public enum PMCrypto {
    static let ivLength = 12
    static let tagLength = 16

    /** The weakest KDF settings accepted from another device (see KDF_LIMITS on desktop). */
    static let minMemoryKiB = 64 * 1024
    static let maxMemoryKiB = 1024 * 1024
    static let minIterations = 3
    static let maxIterations = 64
    static let maxParallelism = 16
    static let minSaltBytes = 16

    public static func randomBytes(_ count: Int) -> [UInt8] {
        // Backed by the system CSPRNG on every platform
        var rng = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
    }

    static func isAcceptableKdf(_ kdf: KdfParams) -> Bool {
        guard kdf.algorithm == "argon2id", let salt = b64decode(kdf.salt) else { return false }
        return salt.count >= minSaltBytes &&
            (minMemoryKiB...maxMemoryKiB).contains(kdf.memoryKiB) &&
            (minIterations...maxIterations).contains(kdf.iterations) &&
            (1...maxParallelism).contains(kdf.parallelism)
    }

    /** Argon2id over the UTF-8 of the NFKC-normalized password, 32-byte output. */
    public static func deriveKey(_ password: String, _ kdf: KdfParams) throws -> [UInt8] {
        guard kdf.algorithm == "argon2id" else { throw VaultError.message("Unsupported KDF: \(kdf.algorithm)") }
        guard let salt = b64decode(kdf.salt), kdf.memoryKiB > 0, kdf.iterations > 0, kdf.parallelism > 0 else {
            throw VaultError.message("Invalid KDF parameters")
        }
        var passwordBytes = Array(password.precomposedStringWithCompatibilityMapping.utf8)
        defer { wipe(&passwordBytes) }
        var out = [UInt8](repeating: 0, count: 32)
        let result = argon2id_hash_raw(
            UInt32(kdf.iterations), UInt32(kdf.memoryKiB), UInt32(kdf.parallelism),
            passwordBytes, passwordBytes.count, salt, salt.count, &out, out.count
        )
        guard result == ARGON2_OK.rawValue else {
            throw VaultError.message("Key derivation failed: \(String(cString: argon2_error_message(result)))")
        }
        return out
    }

    /** AES-256-GCM. Output is base64(iv || ciphertext || tag). */
    public static func seal(_ key: [UInt8], _ plaintext: [UInt8], aad: String) throws -> String {
        let iv = randomBytes(ivLength)
        let box = try AES.GCM.seal(
            plaintext,
            using: SymmetricKey(data: key),
            nonce: AES.GCM.Nonce(data: iv),
            authenticating: Array(aad.utf8)
        )
        return b64encode(iv + Array(box.ciphertext) + Array(box.tag))
    }

    public static func open(_ key: [UInt8], _ sealed: String, aad: String) throws -> [UInt8] {
        guard let raw = b64decode(sealed), raw.count >= ivLength + tagLength, key.count == 32 else {
            throw VaultError.decryptionFailed
        }
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: raw[0..<ivLength]),
                ciphertext: raw[ivLength..<(raw.count - tagLength)],
                tag: raw[(raw.count - tagLength)...]
            )
            return Array(try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: Array(aad.utf8)))
        } catch {
            throw VaultError.decryptionFailed
        }
    }

    public static func sealString(_ key: [UInt8], _ value: String, aad: String) throws -> String {
        try seal(key, Array(value.utf8), aad: aad)
    }

    public static func openString(_ key: [UInt8], _ sealed: String, aad: String) throws -> String {
        guard let text = String(bytes: try open(key, sealed, aad: aad), encoding: .utf8) else {
            throw VaultError.decryptionFailed
        }
        return text
    }

    /** base64url(HMAC-SHA256(key, "pm:key-id:v1")), first 22 characters. */
    public static func keyId(of key: [UInt8]) -> String {
        let mac = HMAC<SHA256>.authenticationCode(for: Array("pm:key-id:v1".utf8), using: SymmetricKey(data: key))
        return String(b64url(Array(mac)).prefix(22))
    }

    /** 18 random bytes as base64url, as the desktop uses for sync nonces. */
    static func nonce() -> String { b64url(randomBytes(18)) }

    public static func b64encode(_ bytes: [UInt8]) -> String { Data(bytes).base64EncodedString() }

    public static func b64decode(_ value: String) -> [UInt8]? { Data(base64Encoded: value).map(Array.init) }

    static func b64url(_ bytes: [UInt8]) -> String {
        b64encode(bytes).replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/** Overwrites a secret in place. Best effort: Swift may have copied it before. */
public func wipe(_ bytes: inout [UInt8]) {
    for i in bytes.indices { bytes[i] = 0 }
}

/** Associated-data labels. Must match AAD in src/main/vault/crypto.ts. */
enum Aad {
    static func vaultKey(_ vaultId: String) -> String { "pm:vault-key:v1:\(vaultId)" }
    static func vaultData(_ vaultId: String) -> String { "pm:vault-data:v1:\(vaultId)" }
    static func previousKey(_ vaultId: String, _ keyId: String, revoked: Bool) -> String {
        "pm:prev-key:v1:\(vaultId):\(keyId):\(revoked ? "revoked" : "forward")"
    }
    static func syncRequest(_ vaultId: String) -> String { "pm:sync-req:v1:\(vaultId)" }
    static func syncResponse(_ vaultId: String, _ nonce: String) -> String { "pm:sync-res:v1:\(vaultId):\(nonce)" }
    static func attachment(_ attachmentId: String) -> String { "pm:attachment:v1:\(attachmentId)" }
    static func attachmentRequest(_ vaultId: String) -> String { "pm:att-req:v1:\(vaultId)" }
    static func attachmentResponse(_ vaultId: String, _ nonce: String) -> String { "pm:att-res:v1:\(vaultId):\(nonce)" }
}

public enum VaultError: LocalizedError, Equatable {
    case incorrectPassword
    case decryptionFailed
    case locked
    case noVault
    case notFound
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .incorrectPassword: return "Incorrect master password"
        case .decryptionFailed: return "Decryption failed"
        case .locked: return "Vault is locked"
        case .noVault: return "No vault exists yet"
        case .notFound: return "Entry not found"
        case .message(let text): return text
        }
    }
}
