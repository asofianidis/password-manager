import Observation
import PMCore
import SwiftUI
import UniformTypeIdentifiers

/** App-wide state: the vault, sync, auto-lock, and the clipboard. Lives on the main actor. */
@MainActor
@Observable
final class AppModel {
    let settings = AppSettings()
    /** Nil if vault.json couldn't be read; `loadError` says why */
    let vault: Vault?
    let loadError: String?
    private(set) var status = VaultStatus(state: .noVault, vaultId: nil, pendingKeyChange: false, revision: 0)
    private(set) var syncing = false
    private(set) var syncFailed = false
    /** A short message to show briefly, e.g. a sync result */
    var toast: String?

    @ObservationIgnored private var client: SyncClient?
    @ObservationIgnored private var pendingSync: Task<Void, Never>?
    @ObservationIgnored private var pendingIdentities: Task<Void, Never>?
    @ObservationIgnored private var autoLockDeadline: Date?
    @ObservationIgnored private var autoLockTimer: Timer?

    init() {
        var loadError: String?
        do {
            vault = try Vault(file: AppGroup.vaultFile)
        } catch {
            vault = nil
            loadError = "Couldn't read the vault: \(error.localizedDescription)"
        }
        self.loadError = loadError
        guard let vault else { return }
        status = vault.status
        let settings = settings
        client = SyncClient(vault: vault, deviceId: { settings.deviceId }, deviceName: { settings.deviceName })
        vault.onStatusChange = { [weak self] status in
            Task { @MainActor in self?.statusChanged(status) }
        }
    }

    private func statusChanged(_ next: VaultStatus) {
        let previous = status
        guard next.revision > previous.revision else { return }
        status = next
        if next.state == .unlocked && previous.state != .unlocked {
            touch()
            syncSoon(delay: 0)
        }
        if next.state != .unlocked { autoLockTimer?.invalidate() }
        if next.state == .unlocked { refreshCredentialIdentities() }
        if next.state == .noVault { Task { await CredentialIdentities.clear() } }
    }

    var entries: [VaultEntry] {
        _ = status.revision
        return ((try? vault?.list()) ?? []).sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    func entry(_ id: String) -> VaultEntry? {
        _ = status.revision
        return vault?.find(id)
    }

    func lock() { vault?.lockVault() }

    // MARK: - Editing

    @discardableResult
    func save(_ input: EntryInput, id: String?) throws -> VaultEntry {
        guard let vault else { throw VaultError.noVault }
        let saved = try id.map { try vault.updateEntry($0, input) } ?? vault.createEntry(input)
        syncSoon()
        return saved
    }

    func toggleFavorite(_ entry: VaultEntry) {
        var input = EntryInput(entry)
        input.favorite.toggle()
        try? save(input, id: entry.id)
    }

    func delete(_ entry: VaultEntry) {
        try? vault?.deleteEntry(entry.id)
        syncSoon()
    }

    /** Removes the vault from this device. Other devices keep their copy. */
    func eraseVault() {
        Biometrics.disable(settings)
        vault?.erase()
        settings.clearVaultState()
    }

    // MARK: - Sync

    /** Syncs after a short delay, so a burst of edits becomes one sync. */
    func syncSoon(delay: Double = 1.5) {
        pendingSync?.cancel()
        pendingSync = Task {
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            _ = await syncAll()
        }
    }

    /** Syncs with every paired desktop. Returns a summary for the UI. */
    func syncAll() async -> String {
        guard let client, let vault else { return "No vault" }
        if settings.peers.isEmpty { return "Add a computer to sync with first" }
        if !vault.isUnlocked { return "Unlock the vault to sync" }
        if syncing { return "Already syncing" }
        syncing = true
        defer { syncing = false }
        var received = 0
        var errors: [String] = []
        for peer in settings.peers {
            do {
                received += try await client.sync(peerName: peer.name, host: peer.host, port: peer.port).received
                settings.updatePeer(peer.id) {
                    $0.lastSyncAt = nowMillis()
                    $0.lastError = nil
                }
            } catch {
                let message = Self.describe(error)
                errors.append("\(peer.name): \(message)")
                settings.updatePeer(peer.id) { $0.lastError = message }
            }
        }
        syncFailed = !errors.isEmpty
        if !errors.isEmpty { return errors.joined(separator: "\n") }
        switch received {
        case 0: return "Up to date"
        case 1: return "1 change received"
        default: return "\(received) changes received"
        }
    }

    func hello(host: String, port: Int) async throws -> HelloResponse {
        guard let client else { throw VaultError.noVault }
        return try await client.hello(host: host, port: port)
    }

    func pair(host: String, port: Int, code: String) async throws -> PairResponse {
        guard let client else { throw VaultError.noVault }
        return try await client.pair(host: host, port: port, code: code)
    }

    static func describe(_ error: Error) -> String {
        switch error {
        case VaultError.incorrectPassword:
            return "Incorrect master password"
        case let SyncError.peer(status, _) where status == 423:
            return "The vault is locked on that computer. Unlock it there and try again."
        case let SyncError.peer(status, message) where status == 403 && message.contains("removed"):
            return "This device was removed from the vault. Pair it again."
        default:
            return error.localizedDescription
        }
    }

    // MARK: - AutoFill suggestions

    func refreshCredentialIdentities() {
        pendingIdentities?.cancel()
        let enabled = settings.quickTypeSuggestions
        let logins = enabled ? ((try? vault?.logins()) ?? []) : []
        pendingIdentities = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            if enabled {
                await CredentialIdentities.replace(with: logins)
            } else {
                await CredentialIdentities.clear()
            }
        }
    }

    // MARK: - Auto-lock

    /** Records activity, pushing the auto-lock deadline back. */
    func touch() {
        if checkExpired() { return }
        autoLockTimer?.invalidate()
        let minutes = settings.autoLockMinutes
        guard minutes > 0, vault?.isUnlocked == true else {
            autoLockDeadline = nil
            return
        }
        let timeout = TimeInterval(minutes * 60)
        autoLockDeadline = Date().addingTimeInterval(timeout)
        autoLockTimer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            Task { @MainActor in _ = self?.checkExpired() }
        }
    }

    /** Locks if the deadline has passed (timers don't run while the app is suspended). */
    @discardableResult
    func checkExpired() -> Bool {
        guard let deadline = autoLockDeadline, vault?.isUnlocked == true, Date() >= deadline else { return false }
        autoLockDeadline = nil
        lock()
        return true
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            if !checkExpired() { touch() }
        case .background:
            if settings.lockOnLeave { lock() }
        default:
            break
        }
    }

    // MARK: - Clipboard

    /** Copies text; secrets stay on this device (no Universal Clipboard) and expire. */
    func copy(_ label: String, _ text: String, sensitive: Bool = true) {
        let seconds = settings.clipboardClearSeconds
        if sensitive {
            var options: [UIPasteboard.OptionsKey: Any] = [.localOnly: true]
            if seconds > 0 { options[.expirationDate] = Date().addingTimeInterval(TimeInterval(seconds)) }
            UIPasteboard.general.setItems([[UTType.plainText.identifier: text]], options: options)
        } else {
            UIPasteboard.general.string = text
        }
        toast = "\(label) copied"
    }
}
