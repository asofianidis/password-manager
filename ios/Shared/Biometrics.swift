import Foundation
import LocalAuthentication
import PMCore
import Security

/**
 * Face ID / Touch ID unlock. The vault key is kept in the keychain under an access control that
 * needs the current biometric enrollment, so it's unreadable without a fresh Face ID or Touch ID
 * check and is lost if a face or finger is added. The master password still works, and is needed
 * after the vault key changes (the master password was changed or a device was revoked on the
 * desktop). The app and the AutoFill extension share the item through their keychain group.
 */
enum Biometrics {
    private static let service = "vault-key"
    private static let account = "biometric"

    enum Failure: LocalizedError {
        case unavailable, cancelled, invalidated, other(String)

        var errorDescription: String? {
            switch self {
            case .unavailable: return "\(Biometrics.name) isn't set up on this device"
            case .cancelled: return nil
            case .invalidated:
                return "Your enrolled faces or fingerprints changed, so \(Biometrics.name) unlock was turned off. Use your master password."
            case .other(let message): return message
            }
        }
    }

    static var available: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    static var name: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Biometric"
        }
    }

    static var symbol: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        default: return "faceid"
        }
    }

    static func enabled(_ settings: AppSettings) -> Bool { settings.biometricKeyId != nil }

    private static func query(_ extra: [String: Any] = [:]) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = AppGroup.keychainGroup { q[kSecAttrAccessGroup as String] = group }
        return q.merging(extra) { _, new in new }
    }

    /** Turns biometric unlock on: checks a biometric, then stores the vault key under it. */
    static func enable(vault: Vault, settings: AppSettings) async throws {
        guard available else { throw Failure.unavailable }
        let key = try vault.key
        let keyId = try vault.keyId
        do {
            _ = try await LAContext().evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Turn on \(name) unlock")
        } catch let error as LAError where [.userCancel, .appCancel, .systemCancel, .userFallback].contains(error.code) {
            throw Failure.cancelled
        }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error
        ) else { throw Failure.other("Couldn't protect the key: \(error!.takeRetainedValue().localizedDescription)") }
        SecItemDelete(query() as CFDictionary)
        let status = SecItemAdd(query([
            kSecValueData as String: Data(key),
            kSecAttrAccessControl as String: access,
        ]) as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure.other("Couldn't store the key (error \(status))") }
        settings.biometricKeyId = keyId
        settings.biometricOffered = true
    }

    static func disable(_ settings: AppSettings) {
        settings.biometricKeyId = nil
        SecItemDelete(query() as CFDictionary)
    }

    /**
     * Whether a biometric can unlock the vault right now. Turns biometric unlock off (with a
     * notice) when the vault key changed since it was set up.
     */
    static func canUnlock(vault: Vault?, settings: AppSettings) -> Bool {
        settings.reload()
        guard let keyId = settings.biometricKeyId, let header = try? vault?.keyHeader else { return false }
        if let current = header.keyId, current != keyId {
            disable(settings)
            settings.notice = "The master password changed, so \(name) unlock was turned off. Turn it on again in Settings."
            return false
        }
        return available
    }

    /** Unlocks the vault with a biometric. Throws Failure.cancelled if the user backed out. */
    static func unlock(vault: Vault, settings: AppSettings, reason: String = "Unlock your vault") async throws {
        let context = LAContext()
        context.localizedFallbackTitle = "Use Master Password"
        context.localizedReason = reason
        let q = query([
            kSecReturnData as String: true,
            kSecUseAuthenticationContext as String: context,
        ])
        // SecItemCopyMatching blocks while the Face ID sheet is up
        let (status, data): (OSStatus, Data?) = await Task.detached {
            var result: CFTypeRef?
            let status = SecItemCopyMatching(q as CFDictionary, &result)
            return (status, result as? Data)
        }.value
        switch status {
        case errSecSuccess:
            guard let data else { throw Failure.other("\(name) unlock failed") }
            if !vault.unlock(withKey: Array(data)) {
                disable(settings)
                throw Failure.other("\(name) unlock no longer works for this vault. Use your master password.")
            }
            settings.notice = nil
        case errSecUserCanceled:
            throw Failure.cancelled
        case errSecItemNotFound, errSecAuthFailed:
            disable(settings)
            throw Failure.invalidated
        default:
            throw Failure.other("\(name) unlock failed (error \(status))")
        }
    }
}
