import PMCore
import SwiftUI

struct HomeView: View {
    var body: some View {
        TabView {
            VaultView()
                .tabItem { Label("Vault", systemImage: "key.fill") }
            NavigationStack { GeneratorView() }
                .tabItem { Label("Generator", systemImage: "wand.and.stars") }
            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
    }
}

/** What the vault list shows. */
private enum Filter: Hashable {
    case all, favorites, type(EntryType)

    var title: String {
        switch self {
        case .all: return "All items"
        case .favorites: return "Favorites"
        case .type(let type): return type.many
        }
    }
}

/** The vault: a list of entries, and the selected one beside it on iPad. */
struct VaultView: View {
    @Environment(AppModel.self) private var model
    @State private var selection: String?
    @State private var query = ""
    @State private var filter = Filter.all
    @State private var creating: EntryType?
    @State private var columns = NavigationSplitViewVisibility.all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            EntryList(selection: $selection, query: query, filter: filter, creating: $creating)
                .navigationTitle(filter == .all ? "Vault" : filter.title)
                .searchable(text: $query, prompt: "Search \(model.entries.count) items")
                .toolbar { toolbar }
        } detail: {
            if let selection, model.entry(selection) != nil {
                NavigationStack { EntryDetailView(id: selection) }
                    .id(selection)
            } else {
                ContentUnavailableView("No item selected", systemImage: "key", description: Text("Choose an item from the list."))
            }
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(item: $creating) { type in
            EntryEditor(id: nil, newType: type) { saved in selection = saved.id }
        }
        .onChange(of: model.status.revision) {
            if let id = selection, model.entry(id) == nil { selection = nil }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Menu {
                Picker("Show", selection: $filter) {
                    Text(Filter.all.title).tag(Filter.all)
                    Label("Favorites", systemImage: "star").tag(Filter.favorites)
                    ForEach(EntryType.allCases) { type in
                        Label(type.many, systemImage: type.symbol).tag(Filter.type(type))
                    }
                }
            } label: {
                Label("Filter", systemImage: filter == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            SyncButton()
            Button { model.lock() } label: { Label("Lock", systemImage: "lock") }
            Menu {
                ForEach(EntryType.allCases) { type in
                    Button { creating = type } label: { Label(type.one, systemImage: type.symbol) }
                }
            } label: {
                Label("New item", systemImage: "plus")
            } primaryAction: {
                if case .type(let type) = filter { creating = type } else { creating = .login }
            }
        }
    }
}

struct SyncButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            Task { model.toast = await model.syncAll() }
        } label: {
            if model.syncing {
                ProgressView()
            } else {
                Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                    .foregroundStyle(model.syncFailed ? Palette.danger : Palette.accent)
            }
        }
        .disabled(model.syncing)
    }
}

private struct EntryList: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: String?
    let query: String
    let filter: Filter
    @Binding var creating: EntryType?
    @State private var offerBiometric = false

    var body: some View {
        let entries = model.entries
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = entries.filter { e in
            let kept: Bool
            switch filter {
            case .all: kept = true
            case .favorites: kept = e.favorite
            case .type(let type): kept = e.entryType == type
            }
            return kept && (q.isEmpty || [e.title, e.username, e.url, e.folder, e.detail].contains { $0.lowercased().contains(q) })
        }
        List(selection: $selection) {
            if model.status.pendingKeyChange {
                Section { PendingKeyBanner() }
            }
            if offerBiometric {
                Section {
                    Banner(
                        text: "Unlock with \(Biometrics.name) instead of typing your master password?",
                        action: "Turn on",
                        onAction: {
                            model.settings.biometricOffered = true
                            Task {
                                do {
                                    if let vault = model.vault { try await Biometrics.enable(vault: vault, settings: model.settings) }
                                } catch Biometrics.Failure.cancelled {
                                } catch {
                                    model.toast = error.localizedDescription
                                }
                                offerBiometric = false
                            }
                        },
                        onDismiss: {
                            model.settings.biometricOffered = true
                            offerBiometric = false
                        }
                    )
                }
            }
            if shown.isEmpty {
                Text(emptyText(entries: entries, q: q))
                    .foregroundStyle(Palette.muted)
                    .listRowBackground(Color.clear)
            }
            ForEach(shown) { entry in
                EntryRow(entry: entry).tag(entry.id)
            }
        }
        .pmBackground()
        .refreshable {
            if !model.settings.peers.isEmpty { model.toast = await model.syncAll() }
        }
        .onAppear {
            offerBiometric = !model.settings.biometricOffered && Biometrics.available && !Biometrics.enabled(model.settings)
        }
    }

    private func emptyText(entries: [VaultEntry], q: String) -> String {
        if entries.isEmpty {
            return model.settings.peers.isEmpty
                ? "Nothing saved yet. Add something with +."
                : "Nothing saved yet. Sync with your computer, or add something with +."
        }
        if q.isEmpty && filter != .favorites { return "No \(filter.title.lowercased()) yet. Add one with +." }
        return "Nothing matches."
    }
}

struct Banner: View {
    let text: String
    let action: String
    let onAction: () -> Void
    var onDismiss: (() -> Void)?
    var color = Palette.info

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(text).font(.subheadline).foregroundStyle(Palette.fg)
            HStack {
                Spacer()
                if let onDismiss {
                    Button("Not now", action: onDismiss).foregroundStyle(Palette.muted)
                }
                Button(action, action: onAction).foregroundStyle(color).fontWeight(.semibold)
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 4)
    }
}

/** Another device changed the master password; it has to be entered here to keep syncing. */
private struct PendingKeyBanner: View {
    @Environment(AppModel.self) private var model
    @State private var open = false
    @State private var password = ""
    @State private var error: String?

    var body: some View {
        Banner(
            text: "The master password was changed on another device. Enter the new one to keep syncing.",
            action: "Enter new password",
            onAction: { open = true },
            color: Palette.warn
        )
        .alert("New master password", isPresented: $open) {
            SecureField("New master password", text: $password)
            Button("Switch") { adopt() }
            Button("Ignore change", role: .destructive) { try? model.vault?.discardPendingKey() }
            Button("Cancel", role: .cancel) { password = "" }
        } message: {
            Text(error ?? "Enter the master password you set on your other device.")
        }
    }

    private func adopt() {
        guard let vault = model.vault else { return }
        let attempt = password
        password = ""
        Task {
            let failure: String? = await Task.detached {
                do {
                    try vault.adoptPendingKey(attempt)
                    return nil
                } catch VaultError.incorrectPassword {
                    return "That isn't the new master password. Try again."
                } catch {
                    return error.localizedDescription
                }
            }.value
            error = failure
            if failure == nil {
                model.syncSoon(delay: 0)
            } else {
                open = true
            }
        }
    }
}
