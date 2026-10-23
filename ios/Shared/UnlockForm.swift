import PMCore
import SwiftUI

/** Master password field, unlock button, and biometric unlock. Used by the app and AutoFill. */
struct UnlockForm: View {
    let vault: Vault
    let settings: AppSettings
    var reason = "Unlock your vault"
    var autoBiometric = true
    var onUnlocked: () -> Void = {}

    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @State private var canBiometric = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 12) {
            SecureField("Master password", text: $password)
                .textContentType(.password)
                .submitLabel(.go)
                .focused($focused)
                .onSubmit(submit)
                .padding(12)
                .background(Palette.raised, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(error == nil ? Palette.lineStrong : Palette.danger))
                .onChange(of: password) { error = nil }
            if let message = error ?? settings.notice {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(error == nil ? Palette.warn : Palette.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button(action: submit) {
                Group {
                    if busy {
                        ProgressView().tint(Palette.accentFg)
                    } else {
                        Text("Unlock").fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 32)
            }
            .buttonStyle(.borderedProminent)
            .disabled(password.isEmpty || busy)
            if canBiometric {
                Button(action: biometric) {
                    Label("Use \(Biometrics.name)", systemImage: Biometrics.symbol).frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.bordered)
                .disabled(busy)
            }
        }
        .task {
            canBiometric = Biometrics.canUnlock(vault: vault, settings: settings)
            if canBiometric && autoBiometric {
                biometric()
            } else {
                focused = true
            }
        }
    }

    private func submit() {
        guard !password.isEmpty, !busy else { return }
        busy = true
        error = nil
        let attempt = password
        Task {
            // Argon2 takes a moment; keep it off the main thread
            let failure = await Task.detached { [vault] () -> String? in
                do {
                    try vault.unlock(attempt)
                    return nil
                } catch VaultError.incorrectPassword {
                    return "Incorrect master password"
                } catch {
                    return error.localizedDescription
                }
            }.value
            busy = false
            if let failure {
                error = failure
            } else {
                password = ""
                settings.notice = nil
                onUnlocked()
            }
        }
    }

    private func biometric() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await Biometrics.unlock(vault: vault, settings: settings, reason: reason)
                onUnlocked()
            } catch Biometrics.Failure.cancelled {
                focused = true
            } catch {
                self.error = error.localizedDescription
                canBiometric = Biometrics.canUnlock(vault: vault, settings: settings)
                focused = true
            }
        }
    }
}

/** The app logo, from the asset catalog in the app and a symbol in AutoFill. */
struct Logo: View {
    var size: CGFloat = 72

    var body: some View {
        if UIImage(named: "Logo") != nil {
            Image("Logo").resizable().frame(width: size, height: size)
        } else {
            Image(systemName: "lock.shield.fill").font(.system(size: size * 0.7)).foregroundStyle(Palette.accent)
        }
    }
}
