import PMCore
import SwiftUI

struct EntryDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let id: String
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var revealed = Set<String>()

    var body: some View {
        if let entry = model.entry(id) {
            List {
                switch entry.entryType {
                case .login: loginSection(entry)
                case .card: cardSection(entry.card ?? CardDetails())
                case .identity: identitySection(entry.identity ?? IdentityDetails())
                case .note, .document: EmptyView()
                }
                if !entry.folder.isEmpty {
                    Section { DetailRow(label: "Folder", value: entry.folder) }
                }
                if !entry.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Section(entry.entryType == .note ? "Note" : "Notes") {
                        Text(entry.notes)
                            .foregroundStyle(Palette.fg)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if entry.entryType == .note {
                            Button { model.copy("Note", entry.notes) } label: { Label("Copy note", systemImage: "doc.on.doc") }
                        }
                    }
                }
                AttachmentsSection(attachments: entry.attachments ?? [])
                Section {
                    Text(footer(entry)).font(.footnote).foregroundStyle(Palette.faint)
                }
                .listRowBackground(Color.clear)
            }
            .pmBackground()
            .navigationTitle(entry.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { model.toggleFavorite(entry) } label: {
                        Label(entry.favorite ? "Remove from favorites" : "Add to favorites", systemImage: entry.favorite ? "star.fill" : "star")
                            .foregroundStyle(entry.favorite ? Palette.warn : Palette.accent)
                    }
                    Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                }
            }
            .confirmationDialog("Delete \(entry.title)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { model.delete(entry) }
            } message: {
                Text("It will also be removed from your synced devices.")
            }
            .sheet(isPresented: $editing) { EntryEditor(id: entry.id, newType: entry.entryType) }
        }
    }

    private func footer(_ entry: VaultEntry) -> String {
        func date(_ ms: Int64) -> String {
            Date(timeIntervalSince1970: TimeInterval(ms) / 1000).formatted(date: .abbreviated, time: .shortened)
        }
        return entry.isLogin
            ? "Modified \(date(entry.updatedAt)) · Password changed \(date(entry.passwordUpdatedAt))"
            : "Modified \(date(entry.updatedAt))"
    }

    private func masked(_ key: String, _ value: String) -> String {
        revealed.contains(key) ? value : String(repeating: "•", count: min(max(value.count, 3), 8))
    }

    private func toggle(_ key: String) {
        if revealed.contains(key) { revealed.remove(key) } else { revealed.insert(key) }
    }

    @ViewBuilder
    private func loginSection(_ entry: VaultEntry) -> some View {
        Section {
            DetailRow(label: "Username", value: entry.username) {
                CopyButton(label: "Username", value: entry.username, sensitive: false)
            }
            DetailRow(label: "Password", value: entry.password.isEmpty ? "" : revealed.contains("password") ? entry.password : "••••••••••••", mono: revealed.contains("password")) {
                if !entry.password.isEmpty {
                    RevealButton(revealed: revealed.contains("password")) { toggle("password") }
                    CopyButton(label: "Password", value: entry.password)
                }
            }
            DetailRow(label: "Website", value: entry.url) {
                if let url = webURL(entry.url) {
                    Button { openURL(url) } label: { Label("Open website", systemImage: "safari") }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                }
            }
            if !entry.totp.isEmpty {
                DetailRow(label: "Two-factor", value: "Secret stored")
            }
        }
    }

    @ViewBuilder
    private func cardSection(_ card: CardDetails) -> some View {
        Section {
            DetailRow(label: "Cardholder", value: card.cardholder) {
                if !card.cardholder.isEmpty { CopyButton(label: "Cardholder", value: card.cardholder, sensitive: false) }
            }
            DetailRow(
                label: cardBrand(card.number) ?? "Card number",
                value: card.number.isEmpty ? "" : revealed.contains("number") ? formatCardNumber(card.number) : "•••• \(card.number.suffix(4))",
                mono: true
            ) {
                if !card.number.isEmpty {
                    RevealButton(revealed: revealed.contains("number")) { toggle("number") }
                    CopyButton(label: "Card number", value: card.number)
                }
            }
            DetailRow(label: "Expires", value: card.expiry, mono: true) {
                if !card.expiry.isEmpty { CopyButton(label: "Expiry", value: card.expiry, sensitive: false) }
            }
            DetailRow(label: "Security code", value: card.cvv.isEmpty ? "" : masked("cvv", card.cvv), mono: true) {
                if !card.cvv.isEmpty {
                    RevealButton(revealed: revealed.contains("cvv")) { toggle("cvv") }
                    CopyButton(label: "Security code", value: card.cvv)
                }
            }
            if !card.pin.isEmpty {
                DetailRow(label: "PIN", value: masked("pin", card.pin), mono: true) {
                    RevealButton(revealed: revealed.contains("pin")) { toggle("pin") }
                    CopyButton(label: "PIN", value: card.pin)
                }
            }
        }
    }

    @ViewBuilder
    private func identitySection(_ identity: IdentityDetails) -> some View {
        Section {
            DetailRow(label: "Type", value: IdentityDetails.kindLabel(identity.kind))
            DetailRow(label: "Full name", value: identity.fullName) {
                if !identity.fullName.isEmpty { CopyButton(label: "Full name", value: identity.fullName, sensitive: false) }
            }
            DetailRow(label: "Number", value: identity.number, mono: true) {
                if !identity.number.isEmpty { CopyButton(label: "ID number", value: identity.number) }
            }
            if !identity.issuer.isEmpty { DetailRow(label: "Issued by", value: identity.issuer) }
            if !identity.issuedOn.isEmpty { DetailRow(label: "Issued", value: identity.issuedOn) }
            if !identity.expiresOn.isEmpty { DetailRow(label: "Expires", value: identity.expiresOn) }
            if !identity.birthDate.isEmpty { DetailRow(label: "Date of birth", value: identity.birthDate) }
        }
    }

    private func webURL(_ url: String) -> URL? {
        let trimmed = url.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") { return URL(string: trimmed) }
        return trimmed.contains("://") ? nil : URL(string: "https://\(trimmed)")
    }
}

private struct DetailRow<Actions: View>: View {
    let label: String
    let value: String
    var mono = false
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(Palette.muted)
                Text(value.isEmpty ? "—" : value)
                    .font(mono ? .body.monospaced() : .body)
                    .foregroundStyle(value.isEmpty ? Palette.faint : Palette.bright)
                    .textSelection(.enabled)
            }
            Spacer()
            HStack(spacing: 16) { actions }
        }
    }
}

private extension DetailRow where Actions == EmptyView {
    init(label: String, value: String, mono: Bool = false) {
        self.init(label: label, value: value, mono: mono) { EmptyView() }
    }
}

private struct CopyButton: View {
    @Environment(AppModel.self) private var model
    let label: String
    let value: String
    var sensitive = true

    var body: some View {
        Button { model.copy(label, value, sensitive: sensitive) } label: {
            Label("Copy \(label.lowercased())", systemImage: "doc.on.doc")
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .disabled(value.isEmpty)
    }
}

private struct RevealButton: View {
    let revealed: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            Label(revealed ? "Hide" : "Show", systemImage: revealed ? "eye.slash" : "eye")
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
    }
}

/** Edits an entry, or creates one of `newType` when `id` is nil. */
struct EntryEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String?
    let newType: EntryType
    var onSaved: (VaultEntry) -> Void = { _ in }
    @State private var input = EntryInput()
    @State private var loaded = false
    @State private var showPassword = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(input.type == .card ? "Name (e.g. Everyday Visa)" : "Title", text: $input.title)
                        .textInputAutocapitalization(.sentences)
                    fields
                }
                Section {
                    TextField("Folder", text: $input.folder)
                    if input.type == .login {
                        TextField("Two-factor secret (otpauth://… or base32)", text: $input.totp)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    Toggle("Favorite", isOn: $input.favorite)
                }
                Section {
                    TextField(input.type == .note ? "Note" : "Notes", text: $input.notes, axis: .vertical)
                        .lineLimit(input.type == .note ? 8... : 3...)
                } header: {
                    Text(input.type == .note ? "Note" : "Notes")
                } footer: {
                    if input.type == .note {
                        Text("Lines like \"Street: 1 Main St\" can be filled into websites from the browser extension.")
                    }
                }
                AttachmentsEditor(attachments: $input.attachments)
                if let error {
                    Text(error).foregroundStyle(Palette.danger)
                }
            }
            .pmBackground()
            .navigationTitle(id == nil ? "New \(input.type.one.lowercased())" : "Edit \(input.type.one.lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).fontWeight(.semibold) }
            }
        }
        .interactiveDismissDisabled(input != initial)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            input = initial
        }
    }

    private var initial: EntryInput {
        id.flatMap(model.entry).map(EntryInput.init) ?? EntryInput(type: newType)
    }

    @ViewBuilder
    private var fields: some View {
        switch input.type {
        case .login:
            TextField("Username or email", text: $input.username)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            HStack {
                Group {
                    if showPassword {
                        TextField("Password", text: $input.password).font(.body.monospaced())
                    } else {
                        SecureField("Password", text: $input.password)
                    }
                }
                .textContentType(.newPassword)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                Button { showPassword.toggle() } label: {
                    Label(showPassword ? "Hide" : "Show", systemImage: showPassword ? "eye.slash" : "eye")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                Button {
                    input.password = Generator.generate(model.settings.generator)
                    showPassword = true
                } label: {
                    Label("Generate password", systemImage: "wand.and.stars")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
            }
            TextField("Website (example.com)", text: $input.url)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        case .card:
            TextField("Cardholder name", text: $input.card.cardholder)
                .textInputAutocapitalization(.words)
                .textContentType(.name)
            TextField("Card number", text: $input.card.number)
                .keyboardType(.numberPad)
                .font(.body.monospaced())
                .onChange(of: input.card.number) { input.card.number = String(input.card.number.filter(\.isNumber).prefix(19)) }
            HStack {
                TextField("Expiry (MM/YY)", text: $input.card.expiry)
                    .keyboardType(.numbersAndPunctuation)
                SecureField("CVV", text: $input.card.cvv)
                    .keyboardType(.numberPad)
            }
            SecureField("PIN (optional)", text: $input.card.pin)
                .keyboardType(.numberPad)
        case .identity:
            Picker("Type", selection: $input.identity.kind) {
                ForEach(IdentityDetails.kinds, id: \.self) { Text(IdentityDetails.kindLabel($0)).tag($0) }
            }
            TextField("Full name", text: $input.identity.fullName)
                .textInputAutocapitalization(.words)
            TextField("Document number", text: $input.identity.number)
                .font(.body.monospaced())
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            TextField("Issued by (country or state)", text: $input.identity.issuer)
                .textInputAutocapitalization(.words)
            DateField(label: "Issued", value: $input.identity.issuedOn)
            DateField(label: "Expires", value: $input.identity.expiresOn)
            DateField(label: "Date of birth", value: $input.identity.birthDate)
        case .note, .document:
            EmptyView()
        }
    }

    private func save() {
        do {
            let saved = try model.save(input, id: id)
            onSaved(saved)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/** A YYYY-MM-DD date that may be blank, as the vault stores ID dates. */
private struct DateField: View {
    let label: String
    @Binding var value: String

    private static let format: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    var body: some View {
        if let date = Self.format.date(from: value) {
            HStack {
                DatePicker(label, selection: Binding(get: { date }, set: { value = Self.format.string(from: $0) }), displayedComponents: .date)
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                Button { value = "" } label: { Label("Clear", systemImage: "xmark.circle.fill") }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .foregroundStyle(Palette.muted)
            }
        } else {
            HStack {
                TextField("\(label) (YYYY-MM-DD)", text: $value)
                    .keyboardType(.numbersAndPunctuation)
                Button("Pick") { value = Self.format.string(from: Date()) }
                    .buttonStyle(.borderless)
            }
        }
    }
}
