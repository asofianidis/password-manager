import PMCore
import SwiftUI

/** Centered content for the setup and lock screens, narrow on iPad. */
private struct CenteredPage<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(spacing: 0) { content }
                .frame(maxWidth: 440)
                .padding(24)
                .padding(.top, 32)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.canvas)
    }
}

struct LockedView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        CenteredPage {
            Logo()
            Text("Vault locked")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Palette.bright)
                .padding(.top, 16)
                .padding(.bottom, 24)
            if let vault = model.vault {
                UnlockForm(vault: vault, settings: model.settings)
            }
        }
    }
}

/** First run: pair with the desktop app, which holds the vault. */
struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var host = ""
    @State private var port = String(defaultSyncPort)
    @State private var code = ""
    @State private var password = ""
    @State private var progress: String?
    @State private var error: String?
    // The computer hands out its key header once per code, so keep it to retry a mistyped password
    @State private var paired: PairResponse?

    private var portNumber: Int? { Int(port).flatMap { (1...65535).contains($0) ? $0 : nil } }
    private var ready: Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty && portNumber != nil && code.count == 6 && !password.isEmpty
    }

    var body: some View {
        CenteredPage {
            Logo()
            Text("Password Manager")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Palette.bright)
                .padding(.top, 16)
            Text("Your vault lives on your computer. Pair this device with it to use your logins here.")
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.muted)
                .padding(.top, 8)
                .padding(.bottom, 24)
            VStack(alignment: .leading, spacing: 10) {
                Step(number: "1", text: "On your computer, open Password Manager → Sync and click Pair a new device.")
                Step(number: "2", text: "Make sure this device can reach it: the same Wi-Fi, or Tailscale on both.")
                Step(number: "3", text: "Enter one of the addresses it shows, and the 6-digit code.")
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line))
            .padding(.bottom, 20)

            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    Field(label: "Computer address", text: $host, placeholder: "100.101.102.103")
                        .keyboardType(.URL)
                    Field(label: "Port", text: $port)
                        .keyboardType(.numberPad)
                        .frame(width: 96)
                }
                Field(label: "Pairing code", text: $code, monospaced: true)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                Field(label: "Master password", text: $password, secure: true)
                    .submitLabel(.go)
                    .onSubmit(pair)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Palette.danger).frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(action: pair) {
                    HStack {
                        if let progress {
                            ProgressView().tint(Palette.accentFg)
                            Text(progress)
                        } else {
                            Text("Pair").fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!ready || progress != nil)
            }
        }
        .onChange(of: host) { paired = nil }
        .onChange(of: port) {
            port = String(port.filter(\.isNumber).prefix(5))
            paired = nil
        }
        .onChange(of: code) {
            code = String(code.filter(\.isNumber).prefix(6))
            paired = nil
        }
    }

    private func pair() {
        guard ready, progress == nil, let portNumber, let vault = model.vault else { return }
        error = nil
        let address = host.trimmingCharacters(in: .whitespaces)
        Task {
            var peerId: String?
            do {
                progress = "Contacting your computer…"
                let response: PairResponse
                if let paired {
                    response = paired
                } else {
                    response = try await model.pair(host: address, port: portNumber, code: code)
                }
                paired = response
                progress = "Unlocking…"
                let peer = SyncPeer(id: UUID().uuidString, name: response.deviceName, host: address, port: portNumber)
                peerId = peer.id
                // Added first, so the sync that runs on unlock includes it
                model.settings.peers = model.settings.peers.filter { $0.host != peer.host || $0.port != peer.port } + [peer]
                let attempt = password
                try await Task.detached {
                    try vault.join(vaultId: response.vaultId, header: response.header, masterPassword: attempt)
                }.value
                password = ""
            } catch {
                if let peerId { model.settings.peers.removeAll { $0.id == peerId } }
                self.error = AppModel.describe(error)
            }
            progress = nil
        }
    }
}

private struct Step: View {
    let number: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(number).font(.body.monospaced()).foregroundStyle(Palette.accent).frame(width: 16)
            Text(text).font(.subheadline).foregroundStyle(Palette.fg)
        }
    }
}

/** A labeled text field in the setup screen's style. */
struct Field: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var secure = false
    var monospaced = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Palette.muted)
            Group {
                if secure {
                    SecureField(placeholder, text: $text).textContentType(.password)
                } else {
                    TextField(placeholder, text: $text)
                }
            }
            .font(monospaced ? .title3.monospaced() : .body)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(12)
            .background(Palette.raised, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.lineStrong))
        }
    }
}
