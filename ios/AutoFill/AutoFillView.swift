import PMCore
import SwiftUI

struct AutoFillView: View {
    @Environment(AutoFillModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                if let error = model.loadError {
                    ContentUnavailableView("Vault unavailable", systemImage: "lock.slash", description: Text(error))
                } else if !model.unlocked, let vault = model.vault {
                    ScrollView {
                        VStack(spacing: 16) {
                            Logo(size: 56)
                            Text(siteName.map { "Unlock to fill on \($0)" } ?? "Unlock to fill")
                                .font(.headline)
                                .foregroundStyle(Palette.bright)
                                .multilineTextAlignment(.center)
                            UnlockForm(vault: vault, settings: model.settings, reason: "Fill a password") { model.didUnlock() }
                        }
                        .frame(maxWidth: 440)
                        .padding(24)
                        .frame(maxWidth: .infinity)
                    }
                } else {
                    LoginPicker()
                }
            }
            .background(Palette.canvas)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.cancel() } }
            }
        }
    }

    private var siteName: String? {
        model.pages.first.flatMap(UrlMatch.host(of:))
    }
}

/** Logins for the page first, then a search over all of them. */
private struct LoginPicker: View {
    @Environment(AutoFillModel.self) private var model
    @State private var query = ""
    @State private var confirming: VaultEntry?

    var body: some View {
        let matches = model.matches
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let others = model.logins.filter { entry in
            !matches.contains { $0.id == entry.id } &&
                (q.isEmpty || [entry.title, entry.username, entry.url].contains { $0.lowercased().contains(q) })
        }
        List {
            if !matches.isEmpty && q.isEmpty {
                Section("For this site") {
                    ForEach(matches) { entry in
                        Button { model.complete(entry) } label: { EntryRow(entry: entry) }
                    }
                }
            }
            Section(matches.isEmpty || !q.isEmpty ? "All logins" : "Other logins") {
                if others.isEmpty {
                    Text(q.isEmpty ? "No other logins." : "Nothing matches.").foregroundStyle(Palette.muted)
                }
                ForEach(others) { entry in
                    // Not saved for this site: make sure before handing it over
                    Button { if model.pages.isEmpty { model.complete(entry) } else { confirming = entry } } label: { EntryRow(entry: entry) }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search vault")
        .navigationTitle("Password Manager")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            "Fill \(confirming?.title ?? "this login")?",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible,
            presenting: confirming
        ) { entry in
            Button("Fill") { model.complete(entry) }
        } message: { entry in
            let site = model.pages.first.flatMap(UrlMatch.host(of:)) ?? "this site"
            Text("\(entry.title) isn't saved for \(site). Only fill it if you trust this site.")
        }
    }
}
