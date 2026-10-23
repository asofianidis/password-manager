import AuthenticationServices
import Observation
import PMCore
import SwiftUI

/**
 * The AutoFill extension: iOS opens it from a login field's password key or a suggestion above
 * the keyboard. It reads the app's vault without writing to it, unlocks it with Face ID or the
 * master password, and hands over the chosen login.
 */
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private lazy var model = AutoFillModel(
        complete: { [weak self] entry in
            self?.extensionContext.completeRequest(
                withSelectedCredential: ASPasswordCredential(user: entry.username, password: entry.password)
            )
        },
        cancel: { [weak self] in
            self?.extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
        }
    )

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: AutoFillView().environment(model).preferredColorScheme(.dark).tint(Palette.accent))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    /** The user tapped the password key: show logins for the page or app. */
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        model.start(.list(serviceIdentifiers.map(AutoFillModel.pageUrl)))
    }

    /** The user picked a suggestion above the keyboard. The vault is never unlocked here without asking. */
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
    }

    /** After userInteractionRequired: unlock, then fill the suggestion the user picked. */
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        model.start(.record(credentialRequest.credentialIdentity.recordIdentifier ?? ""))
    }
}

@MainActor
@Observable
final class AutoFillModel {
    enum Request {
        /** Show logins for these pages */
        case list([String])
        /** Fill this entry, chosen from the keyboard suggestions */
        case record(String)
    }

    let settings = AppSettings()
    let vault: Vault?
    let loadError: String?
    private(set) var request: Request?
    private(set) var unlocked = false
    @ObservationIgnored let complete: (VaultEntry) -> Void
    @ObservationIgnored let cancel: () -> Void

    init(complete: @escaping (VaultEntry) -> Void, cancel: @escaping () -> Void) {
        self.complete = complete
        self.cancel = cancel
        var loadError: String?
        var vault: Vault?
        do {
            vault = try Vault(file: AppGroup.vaultFile, readOnly: true)
            if vault?.status.state == .noVault { loadError = "Open Password Manager and pair it with your computer first." }
        } catch {
            loadError = "Couldn't read the vault: \(error.localizedDescription)"
        }
        self.vault = vault
        self.loadError = loadError
    }

    /** A service identifier as a URL to match against: domains become https pages. */
    nonisolated static func pageUrl(_ identifier: ASCredentialServiceIdentifier) -> String {
        identifier.type == .URL ? identifier.identifier : "https://\(identifier.identifier)"
    }

    func start(_ request: Request) {
        self.request = request
    }

    func didUnlock() {
        unlocked = true
        if case .record(let id) = request {
            if let entry = vault?.find(id), entry.isLogin {
                complete(entry)
            } else {
                // The suggestion is stale (deleted or changed since); let the user pick instead
                request = .list([])
            }
        }
    }

    var logins: [VaultEntry] {
        ((try? vault?.logins()) ?? []).sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    var pages: [String] {
        if case .list(let pages) = request { return pages }
        return []
    }

    /** Logins saved for the page being filled, best match first. */
    var matches: [VaultEntry] {
        var seen = Set<String>()
        return pages.flatMap { UrlMatch.forPage(logins, pageUrl: $0) }.filter { seen.insert($0.id).inserted }
    }
}
