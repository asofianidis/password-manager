import Foundation
import PMCore

/**
 * Where the app and its AutoFill extension keep their shared state: the app group container
 * (vault.json and attachments) and its UserDefaults suite (settings). Builds without the app
 * group entitlement, such as unsigned simulator builds, fall back to the app's own storage.
 */
enum AppGroup {
    static let id = Bundle.main.object(forInfoDictionaryKey: "PMAppGroup") as? String

    /** The keychain access group both targets list in their entitlements */
    static let keychainGroup: String? = {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "PMKeychainGroup") as? String else { return nil }
        // Signed builds start with the team id ("ABCDE12345."); unsigned ones have no prefix and
        // can't use a group at all
        let prefix = group.prefix { $0 != "." }
        let isTeamId = prefix.count == 10 && prefix.allSatisfy { $0.isUppercase || $0.isNumber }
        return isTeamId ? group : nil
    }()

    static let defaults: UserDefaults = id.flatMap(UserDefaults.init(suiteName:)) ?? .standard

    /** Holds vault.json and attachments/. Excluded from backups, like the Android app. */
    static let vaultDirectory: URL = {
        let fm = FileManager.default
        let base = id.flatMap(fm.containerURL(forSecurityApplicationGroupIdentifier:))
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("Vault", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }()

    static var vaultFile: URL { vaultDirectory.appendingPathComponent("vault.json") }
}
