import AuthenticationServices
import PMCore

/**
 * The usernames iOS suggests above the keyboard. iOS only gets each login's site and username
 * (never the password); picking a suggestion opens the AutoFill extension, which unlocks the
 * vault and hands over that login.
 */
enum CredentialIdentities {
    static func replace(with logins: [VaultEntry]) async {
        let store = ASCredentialIdentityStore.shared
        guard await store.state().isEnabled else { return }
        let identities: [any ASCredentialIdentity] = logins.compactMap { entry in
            // iOS matches suggestions by domain, so skip hosts that unrelated sites share (a
            // public suffix such as github.io) or that aren't domains at all
            guard let host = UrlMatch.host(of: entry.url),
                  !host.contains(":"), !host.allSatisfy({ $0 == "." || $0.isNumber }),
                  PublicSuffix.registrableDomain(host) != nil
            else { return nil }
            return ASPasswordCredentialIdentity(
                serviceIdentifier: ASCredentialServiceIdentifier(identifier: host, type: .domain),
                user: entry.username,
                recordIdentifier: entry.id
            )
        }
        try? await store.replaceCredentialIdentities(identities)
    }

    static func clear() async {
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
    }

    /** Whether Password Manager is turned on under AutoFill & Passwords. */
    static func autoFillEnabled() async -> Bool {
        await ASCredentialIdentityStore.shared.state().isEnabled
    }
}
