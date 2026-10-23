import PhotosUI
import PMCore
import SwiftUI
import UniformTypeIdentifiers

/** Attachments of a saved entry: image thumbnails (tap for full size) and files to save. */
struct AttachmentsSection: View {
    @Environment(AppModel.self) private var model
    let attachments: [Attachment]
    @State private var exporting: ExportedFile?

    var body: some View {
        if !attachments.isEmpty {
            Section("Files") {
                ForEach(attachments) { attachment in
                    AttachmentRow(attachment: attachment) {
                        Button { export(attachment) } label: { Label("Save \(attachment.name)", systemImage: "square.and.arrow.down") }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                    }
                }
            }
            .fileExporter(
                isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
                document: exporting,
                contentType: exporting?.type ?? .data,
                defaultFilename: exporting?.name
            ) { result in
                if case .success = result { model.toast = "Saved \(exporting?.name ?? "file")" }
                exporting = nil
            }
        }
    }

    private func export(_ attachment: Attachment) {
        guard let vault = model.vault else { return }
        do {
            guard let bytes = try vault.decryptAttachment(attachment) else {
                model.toast = "Not downloaded yet. Sync to fetch it."
                return
            }
            exporting = ExportedFile(name: attachment.name, mime: attachment.mime, data: Data(bytes))
        } catch {
            model.toast = "Couldn't open the file: \(error.localizedDescription)"
        }
    }
}

/** A decrypted attachment handed to the system's save dialog. Kept in memory only. */
private struct ExportedFile: FileDocument {
    static let readableContentTypes: [UTType] = [.data]
    let name: String
    let type: UTType
    let data: Data

    init(name: String, mime: String, data: Data) {
        self.name = name
        type = UTType(mimeType: mime) ?? UTType(filenameExtension: (name as NSString).pathExtension) ?? .data
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        throw CocoaError(.fileReadUnsupportedScheme)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

/** Attachments in the editor: remove existing ones, add photos or any file. */
struct AttachmentsEditor: View {
    @Environment(AppModel.self) private var model
    @Binding var attachments: [Attachment]
    @State private var photo: PhotosPickerItem?
    @State private var importing = false
    @State private var busy = false

    var body: some View {
        Section("Files") {
            ForEach(attachments) { attachment in
                AttachmentRow(attachment: attachment) {
                    Button(role: .destructive) { attachments.removeAll { $0.id == attachment.id } } label: {
                        Label("Remove \(attachment.name)", systemImage: "xmark.circle.fill")
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .foregroundStyle(Palette.muted)
                }
            }
            HStack(spacing: 20) {
                PhotosPicker(selection: $photo, matching: .images) { Label("Photo", systemImage: "photo.badge.plus") }
                Button { importing = true } label: { Label("File", systemImage: "paperclip") }
                if busy { ProgressView() }
            }
            .buttonStyle(.borderless)
            .disabled(busy)
        }
        .onChange(of: photo) {
            guard let item = photo else { return }
            photo = nil
            add {
                guard let data = try await item.loadTransferable(type: Data.self) else { throw VaultError.message("Couldn't read the photo") }
                let type = item.supportedContentTypes.first { $0.conforms(to: .image) } ?? .jpeg
                let name = "photo-\(Date().formatted(.iso8601.year().month().day())).\(type.preferredFilenameExtension ?? "jpg")"
                return (name, type.preferredMIMEType ?? "image/jpeg", data)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            guard case .success(let url) = result else { return }
            add {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > Attachment.maxBytes { throw Self.tooBig }
                let data = try Data(contentsOf: url)
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                return (url.lastPathComponent, mime, data)
            }
        }
    }

    private static var tooBig: VaultError { .message("Files must be \(Attachment.maxBytes / 1024 / 1024) MB or smaller") }

    /** Reads a picked file and stores it encrypted. */
    private func add(_ read: @escaping () async throws -> (name: String, mime: String, data: Data)) {
        guard let vault = model.vault else { return }
        if attachments.count >= Attachment.maxPerEntry {
            model.toast = "An entry can have at most \(Attachment.maxPerEntry) files"
            return
        }
        busy = true
        Task {
            defer { busy = false }
            do {
                let file = try await read()
                if file.data.count > Attachment.maxBytes { throw Self.tooBig }
                let attachment = try await Task.detached {
                    try vault.addAttachment(name: file.name, mime: file.mime, data: Array(file.data))
                }.value
                attachments.append(attachment)
            } catch {
                model.toast = error.localizedDescription
            }
        }
    }
}

private enum Thumb {
    case loading, missing, file, image(UIImage)
}

private struct AttachmentRow<Actions: View>: View {
    @Environment(AppModel.self) private var model
    let attachment: Attachment
    @ViewBuilder var actions: Actions
    @State private var thumb = Thumb.loading
    @State private var fullSize = false

    var body: some View {
        HStack(spacing: 12) {
            Button { fullSize = true } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 8).fill(Palette.raised)
                    if case .image(let image) = thumb {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        Image(systemName: "doc").foregroundStyle(Palette.muted)
                    }
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.borderless)
            .disabled(!isImage)
            .accessibilityLabel(attachment.name)
            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.name).foregroundStyle(Palette.bright).lineLimit(1).truncationMode(.middle)
                if case .missing = thumb {
                    Text("Not downloaded yet — sync to fetch").font(.caption).foregroundStyle(Palette.warn)
                } else {
                    Text(ByteCountFormatter.string(fromByteCount: attachment.size, countStyle: .file))
                        .font(.caption).foregroundStyle(Palette.muted)
                }
            }
            Spacer()
            actions
        }
        .task(id: attachment.id) {
            guard let vault = model.vault else { return }
            let attachment = attachment
            thumb = await Task.detached {
                guard let bytes = try? vault.decryptAttachment(attachment) else { return Thumb.missing }
                guard attachment.isImage, let image = UIImage(data: Data(bytes)) else { return Thumb.file }
                return image.preparingThumbnail(of: CGSize(width: 160, height: 160)).map(Thumb.image) ?? .file
            }.value
        }
        .fullScreenCover(isPresented: $fullSize) { ImageViewer(attachment: attachment) }
    }

    private var isImage: Bool {
        if case .image = thumb { return true }
        return false
    }
}

private struct ImageViewer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let attachment: Attachment
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                ProgressView()
            }
        }
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.title).foregroundStyle(.white.opacity(0.8))
            }
            .accessibilityLabel("Close")
            .padding()
        }
        .onTapGesture { dismiss() }
        .task {
            guard let vault = model.vault else { return }
            let attachment = attachment
            image = await Task.detached {
                (try? vault.decryptAttachment(attachment)).flatMap { UIImage(data: Data($0)) }
            }.value
        }
    }
}
