import AuthenticationServices
import PMCore
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var autoFillOn = false
    @State private var biometricOn = false
    @State private var addingPeer = false
    @State private var confirmRemove = false

    var body: some View {
        @Bindable var settings = model.settings
        Form {
            Section {
                Label(
                    autoFillOn ? "Password Manager fills logins in apps and Safari" : "AutoFill is off",
                    systemImage: autoFillOn ? "checkmark.circle.fill" : "exclamationmark.circle"
                )
                .foregroundStyle(autoFillOn ? Palette.ok : Palette.warn)
                if !autoFillOn {
                    Text("Turn on Password Manager under Settings → General → AutoFill & Passwords to fill logins in apps and browsers.")
                        .font(.footnote).foregroundStyle(Palette.muted)
                }
                Button(autoFillOn ? "AutoFill settings" : "Turn on AutoFill") {
                    ASSettingsHelper.openCredentialProviderAppSettings { _ in }
                }
                Toggle(isOn: $settings.quickTypeSuggestions) {
                    VStack(alignment: .leading) {
                        Text("Suggest logins above the keyboard")
                        Text("iOS sees each login's website and username, never its password.")
                            .font(.caption).foregroundStyle(Palette.muted)
                    }
                }
                .onChange(of: settings.quickTypeSuggestions) { model.refreshCredentialIdentities() }
            } header: {
                Text("AutoFill")
            }

            Section("Unlock") {
                if Biometrics.available {
                    Toggle(isOn: Binding(get: { biometricOn }, set: setBiometric)) {
                        VStack(alignment: .leading) {
                            Text("\(Biometrics.name) unlock")
                            Text("Instead of your master password, here and in AutoFill").font(.caption).foregroundStyle(Palette.muted)
                        }
                    }
                }
                Picker("Lock after", selection: $settings.autoLockMinutes) {
                    Text("1 minute").tag(1)
                    Text("5 minutes").tag(5)
                    Text("15 minutes").tag(15)
                    Text("1 hour").tag(60)
                    Text("Never").tag(0)
                }
                .onChange(of: settings.autoLockMinutes) { model.touch() }
                Toggle("Lock when leaving the app", isOn: $settings.lockOnLeave)
                Toggle("Hide in the app switcher", isOn: $settings.hideInSwitcher)
                Picker("Clear copied secrets after", selection: $settings.clipboardClearSeconds) {
                    Text("15 seconds").tag(15)
                    Text("30 seconds").tag(30)
                    Text("1 minute").tag(60)
                    Text("Never").tag(0)
                }
            }

            Section {
                TextField("This device's name", text: $settings.deviceName)
                if settings.peers.isEmpty {
                    Text("No computers yet.").foregroundStyle(Palette.muted)
                }
                ForEach(settings.peers) { peer in PeerRow(peer: peer) }
                    .onDelete { settings.peers.remove(atOffsets: $0) }
                Button(model.syncing ? "Syncing…" : "Sync now") {
                    Task { model.toast = await model.syncAll() }
                }
                .disabled(model.syncing || settings.peers.isEmpty)
                Button("Add computer") { addingPeer = true }
            } header: {
                Text("Sync")
            } footer: {
                Text("This device syncs with your computers when you unlock it and after each change. They need Accept sync connections turned on and the vault unlocked. Swipe a computer to stop syncing with it.")
            }

            Section {
                Button("Lock now") { model.lock() }
                Button("Remove from this device", role: .destructive) { confirmRemove = true }
            } header: {
                Text("Vault")
            } footer: {
                Text("To change your master password, use Password Manager on your computer. This device switches over on its next sync.")
            }

            Section {
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
            }
        }
        .pmBackground()
        .navigationTitle("Settings")
        .sheet(isPresented: $addingPeer) { AddPeerSheet() }
        .confirmationDialog("Remove the vault from this device?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { model.eraseVault() }
        } message: {
            Text("Your logins stay on your computer and other devices. Changes made here that haven't synced yet are lost. You can pair again later.")
        }
        .task(id: scenePhase) {
            autoFillOn = await CredentialIdentities.autoFillEnabled()
            biometricOn = Biometrics.enabled(model.settings)
        }
    }

    private func setBiometric(_ on: Bool) {
        if !on {
            Biometrics.disable(model.settings)
            biometricOn = false
            return
        }
        guard let vault = model.vault else { return }
        Task {
            do {
                try await Biometrics.enable(vault: vault, settings: model.settings)
            } catch Biometrics.Failure.cancelled {
            } catch {
                model.toast = error.localizedDescription
            }
            biometricOn = Biometrics.enabled(model.settings)
        }
    }
}

private struct PeerRow: View {
    let peer: SyncPeer

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(peer.name).foregroundStyle(Palette.bright)
            Text("\(peer.host):\(String(peer.port))").font(.caption.monospaced()).foregroundStyle(Palette.muted)
            if let error = peer.lastError {
                Text(error).font(.caption).foregroundStyle(Palette.danger)
            } else if let at = peer.lastSyncAt {
                Text("Synced \(Date(timeIntervalSince1970: TimeInterval(at) / 1000).formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(Palette.ok)
            } else {
                Text("Not synced yet").font(.caption).foregroundStyle(Palette.muted)
            }
        }
    }
}

/** Adds another computer that already has this vault (no pairing needed: it holds the same key). */
private struct AddPeerSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var host = ""
    @State private var port = String(defaultSyncPort)
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Address", text: $host)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Port", text: $port).keyboardType(.numberPad)
                } footer: {
                    Text("A computer that already has this vault. To set up a new one, pair it from a computer that has it.")
                }
                if let error {
                    Text(error).foregroundStyle(Palette.danger)
                }
            }
            .pmBackground()
            .navigationTitle("Add a computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Checking…" : "Add", action: add).disabled(busy || host.isEmpty || portNumber == nil)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var portNumber: Int? { Int(port).flatMap { (1...65535).contains($0) ? $0 : nil } }

    private func add() {
        guard let portNumber else { return }
        let address = host.trimmingCharacters(in: .whitespaces)
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let hello = try await model.hello(host: address, port: portNumber)
                let vaultId = try? model.vault?.vaultId
                if hello.app != "pm" {
                    error = "That isn't Password Manager"
                } else if hello.vaultId != vaultId {
                    error = "\(hello.deviceName) has a different vault"
                } else {
                    model.settings.peers = model.settings.peers.filter { $0.host != address || $0.port != portNumber }
                        + [SyncPeer(id: UUID().uuidString, name: hello.deviceName, host: address, port: portNumber)]
                    model.syncSoon(delay: 0)
                    dismiss()
                }
            } catch {
                self.error = AppModel.describe(error)
            }
        }
    }
}
