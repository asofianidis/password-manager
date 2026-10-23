import Foundation
import Observation
import PMCore
import UIKit

/** A desktop this device syncs with. */
struct SyncPeer: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var host: String
    var port: Int
    var lastSyncAt: Int64?
    var lastError: String?
}

/**
 * Device settings, shared with the AutoFill extension through the app group. Nothing secret
 * lives here; the vault is in vault.json and the biometric key in the keychain.
 */
@Observable
final class AppSettings {
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = AppGroup.defaults) {
        self.defaults = defaults
        peers = Self.read([SyncPeer].self, defaults, "peers") ?? []
        generator = Self.read(GeneratorOptions.self, defaults, "generator") ?? GeneratorOptions()
        deviceName = defaults.string(forKey: "deviceName") ?? UIDevice.current.name
        autoLockMinutes = defaults.object(forKey: "autoLockMinutes") as? Int ?? 5
        lockOnLeave = defaults.bool(forKey: "lockOnLeave")
        hideInSwitcher = defaults.object(forKey: "hideInSwitcher") as? Bool ?? true
        clipboardClearSeconds = defaults.object(forKey: "clipboardClearSeconds") as? Int ?? 30
        biometricKeyId = defaults.string(forKey: "biometricKeyId")
        biometricOffered = defaults.bool(forKey: "biometricOffered")
        notice = defaults.string(forKey: "notice")
        quickTypeSuggestions = defaults.object(forKey: "quickTypeSuggestions") as? Bool ?? true
    }

    var deviceId: String {
        if let id = defaults.string(forKey: "deviceId") { return id }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: "deviceId")
        return id
    }

    var deviceName: String {
        didSet { defaults.set(deviceName.trimmingCharacters(in: .whitespaces), forKey: "deviceName") }
    }

    var peers: [SyncPeer] {
        didSet { write(peers, "peers") }
    }

    var generator: GeneratorOptions {
        didSet { write(generator, "generator") }
    }

    /** 0 = never */
    var autoLockMinutes: Int {
        didSet { defaults.set(autoLockMinutes, forKey: "autoLockMinutes") }
    }

    /** Lock as soon as the app goes to the background */
    var lockOnLeave: Bool {
        didSet { defaults.set(lockOnLeave, forKey: "lockOnLeave") }
    }

    /** Cover the vault in the app switcher */
    var hideInSwitcher: Bool {
        didSet { defaults.set(hideInSwitcher, forKey: "hideInSwitcher") }
    }

    var clipboardClearSeconds: Int {
        didSet { defaults.set(clipboardClearSeconds, forKey: "clipboardClearSeconds") }
    }

    /** The key id of the vault key stored for biometric unlock; nil when it's off */
    var biometricKeyId: String? {
        didSet { defaults.set(biometricKeyId, forKey: "biometricKeyId") }
    }

    /** Whether the vault list already suggested turning on biometric unlock */
    var biometricOffered: Bool {
        didSet { defaults.set(biometricOffered, forKey: "biometricOffered") }
    }

    /** Shown once on the unlock screen, e.g. after biometric unlock was turned off. */
    var notice: String? {
        didSet { defaults.set(notice, forKey: "notice") }
    }

    /** Let iOS suggest usernames above the keyboard (it never sees passwords) */
    var quickTypeSuggestions: Bool {
        didSet { defaults.set(quickTypeSuggestions, forKey: "quickTypeSuggestions") }
    }

    /** Re-reads what the other process (app or AutoFill) may have changed. */
    func reload() {
        biometricKeyId = defaults.string(forKey: "biometricKeyId")
        notice = defaults.string(forKey: "notice")
    }

    func updatePeer(_ id: String, _ change: (inout SyncPeer) -> Void) {
        guard let index = peers.firstIndex(where: { $0.id == id }) else { return }
        change(&peers[index])
    }

    /** Forgets everything tied to the vault, when it is removed from this device. */
    func clearVaultState() {
        peers = []
        biometricKeyId = nil
        biometricOffered = false
    }

    private func write<T: Encodable>(_ value: T, _ key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }

    private static func read<T: Decodable>(_ type: T.Type, _ defaults: UserDefaults, _ key: String) -> T? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(type, from: $0) }
    }
}
