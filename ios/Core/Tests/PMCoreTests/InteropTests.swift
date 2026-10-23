import Foundation
@testable import PMCore
import XCTest

/**
 * Checks this app against fixtures written by the desktop app's own code
 * (android/scripts/fixtures.test.ts, shared with the Android tests), so they stay compatible.
 */
final class InteropTests: XCTestCase {
    struct CanonicalCase: Decodable {
        var entry: VaultEntry
        var json: String
    }

    struct TieCase: Decodable {
        var a: VaultEntry
        var b: VaultEntry
        var winner: String
    }

    struct MatchCase: Decodable {
        var entryUrl: String
        var pageUrl: String
        var level: Int
    }

    struct AttachmentCase: Decodable {
        var entryId: String
        var id: String
        var blob: String
        var content: String
    }

    struct Fixtures: Decodable {
        var password: String
        var oldPassword: String
        var vault: VaultFile
        var oldVault: VaultFile
        var typedVault: VaultFile
        var attachment: AttachmentCase
        var canonical: [CanonicalCase]
        var ties: [TieCase]
        var matches: [MatchCase]
    }

    /// Stands in for the fixtures' lone surrogate, which a Swift String can't hold
    static let loneSurrogate = "\u{E000}"

    static let fixtures: Fixtures = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("android/app/src/test/resources/interop.json")
        let text = try! String(contentsOf: url, encoding: .utf8).replacingOccurrences(of: "\\ud800", with: "\\ue000")
        return try! JSONDecoder().decode(Fixtures.self, from: Data(text.utf8))
    }()

    var fixtures: Fixtures { Self.fixtures }

    private func vaultFile(_ contents: VaultFile? = nil) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pm-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("vault.json")
        try Data((contents ?? fixtures.vault).json.text.utf8).write(to: file)
        return file
    }

    func testAdoptsAMasterPasswordChangeFromTheDesktop() throws {
        // A device still on the old password syncs and receives the new header
        let vault = try Vault(file: try vaultFile(fixtures.oldVault))
        try vault.unlock(fixtures.oldPassword)
        let oldKeyId = try vault.keyId
        try vault.applyRemote([], header: fixtures.vault.key)
        XCTAssertTrue(vault.status.pendingKeyChange)
        XCTAssertEqual(oldKeyId, try vault.keyId)

        XCTAssertThrowsError(try vault.adoptPendingKey(fixtures.oldPassword), "the old password must not open the new header") {
            XCTAssertEqual($0 as? VaultError, .incorrectPassword)
        }
        try vault.adoptPendingKey(fixtures.password)
        XCTAssertFalse(vault.status.pendingKeyChange)
        XCTAssertEqual(fixtures.vault.key.keyId, try vault.keyId)
        XCTAssertEqual(1, try vault.list().count)
    }

    func testUnlocksWithOnlyTheNewPasswordAfterReceivingTheNewHeader() throws {
        let file = try vaultFile(fixtures.oldVault)
        do {
            let vault = try Vault(file: file)
            try vault.unlock(fixtures.oldPassword)
            try vault.applyRemote([], header: fixtures.vault.key)
            vault.lockVault()
        }
        // The data is still sealed with the old key; the new header's retired keys open it
        let vault = try Vault(file: file)
        try vault.unlock(fixtures.password)
        XCTAssertFalse(vault.status.pendingKeyChange)
        XCTAssertEqual(fixtures.vault.key.keyId, try vault.keyId)
        XCTAssertEqual(["hunter2"], try vault.list().map(\.password))
        // And the old password no longer works
        vault.lockVault()
        XCTAssertThrowsError(try Vault(file: file).unlock(fixtures.oldPassword)) {
            XCTAssertEqual($0 as? VaultError, .incorrectPassword)
        }
    }

    func testIgnoresOlderOrWeakerHeaders() throws {
        let vault = try Vault(file: try vaultFile())
        try vault.unlock(fixtures.password)
        try vault.applyRemote([], header: fixtures.oldVault.key)
        XCTAssertFalse(vault.status.pendingKeyChange, "an older header is ignored")
        var weak = fixtures.vault.key
        weak.updatedAt = Int64.max / 2
        weak.kdf.memoryKiB = 1024
        try vault.applyRemote([], header: weak)
        XCTAssertFalse(vault.status.pendingKeyChange, "a header with a weak KDF is ignored")
    }

    func testUnlocksADesktopVaultAfterKeyRotation() throws {
        let file = try vaultFile()
        let vault = try Vault(file: file)
        XCTAssertEqual(.locked, vault.status.state)
        XCTAssertThrowsError(try vault.unlock(fixtures.oldPassword), "old password must not open the rotated vault")
        try vault.unlock(fixtures.password)
        let live = try vault.list()
        XCTAssertEqual(1, live.count)
        XCTAssertEqual("hunter2", live[0].password)
        XCTAssertEqual("line 1\nline \"2\"\t\\ é 🔑", live[0].notes)
        XCTAssertEqual(2, try vault.allRecords().count)
        XCTAssertTrue(try vault.allRecords().contains(where: \.isDeleted))
        XCTAssertEqual(fixtures.vault.key.keyId, try vault.keyId)
        XCTAssertEqual(1, try vault.retiredKeys().count)

        // An edit made here re-seals the file so the desktop's format still reads it
        var input = EntryInput(live[0])
        input.password = "new pw"
        let updated = try vault.updateEntry(live[0].id, input)
        vault.lockVault()
        let reopened = try Vault(file: file)
        try reopened.unlock(fixtures.password)
        XCTAssertEqual(updated, try reopened.get(updated.id))
    }

    func testUnlocksWithTheVaultKeyForBiometrics() throws {
        let vault = try Vault(file: try vaultFile())
        try vault.unlock(fixtures.password)
        let key = try vault.key
        vault.lockVault()
        XCTAssertFalse(vault.unlock(withKey: [UInt8](repeating: 0, count: 32)))
        XCTAssertTrue(vault.unlock(withKey: key))
        XCTAssertEqual(1, try vault.list().count)
    }

    func testReadOnlyVaultNeverWrites() throws {
        let file = try vaultFile(fixtures.oldVault)
        do {
            let vault = try Vault(file: file)
            try vault.unlock(fixtures.oldPassword)
            try vault.applyRemote([], header: fixtures.vault.key)
        }
        let before = try Data(contentsOf: file)
        // AutoFill can unlock with the new password without adopting the header on disk
        let readOnly = try Vault(file: file, readOnly: true)
        try readOnly.unlock(fixtures.password)
        XCTAssertEqual(["hunter2"], try readOnly.logins().map(\.password))
        XCTAssertEqual(before, try Data(contentsOf: file))
    }

    func testCanonicalJsonMatchesJavaScript() throws {
        let cases = fixtures.canonical.filter { !$0.json.contains("\\ue000") }
        XCTAssertGreaterThan(cases.count, 20)
        for c in cases { XCTAssertEqual(c.json, canonicalJson(c.entry)) }
    }

    func testReadsCardsIdsNotesAndAttachmentsFromTheDesktop() throws {
        let file = try vaultFile(fixtures.typedVault)
        let vault = try Vault(file: file)
        try vault.unlock(fixtures.password)
        let byTitle = Dictionary(uniqueKeysWithValues: try vault.list().map { ($0.title, $0) })
        let card = try XCTUnwrap(byTitle["Visa"])
        XCTAssertEqual(.card, card.entryType)
        XCTAssertEqual("4242424242424242", card.card?.number)
        XCTAssertEqual("Visa •••• 4242", card.detail)
        let passport = try XCTUnwrap(byTitle["Passport"])
        XCTAssertEqual("passport", passport.identity?.kind)
        XCTAssertEqual("Passport · United States", passport.detail)
        XCTAssertEqual("Street: 1 Main St", byTitle["Address"]?.detail)
        XCTAssertTrue(try XCTUnwrap(byTitle["GitHub"]).isLogin)
        XCTAssertEqual(["GitHub"], try vault.logins().map(\.title))

        // The entry arrives before its file does
        let a = fixtures.attachment
        XCTAssertNil(try vault.readAttachment(entryId: a.entryId, attachmentId: a.id))
        XCTAssertFalse(vault.storeAttachmentBlob(a.id, fixtures.vault.data))
        XCTAssertTrue(vault.storeAttachmentBlob(a.id, a.blob))
        let content = try XCTUnwrap(try vault.readAttachment(entryId: a.entryId, attachmentId: a.id))
        XCTAssertEqual(a.content, String(decoding: content, as: UTF8.self))
        XCTAssertFalse(vault.storeAttachmentBlob("unreferenced-id", a.blob), "only referenced files are stored")

        // Editing a typed entry here keeps everything the desktop wrote
        let updated = try vault.updateEntry(passport.id, EntryInput(passport))
        var expected = passport
        expected.updatedAt = updated.updatedAt
        XCTAssertEqual(expected, updated)
        vault.lockVault()
        let reopened = try Vault(file: file)
        try reopened.unlock(fixtures.password)
        XCTAssertEqual(updated, try reopened.get(updated.id))
        XCTAssertTrue(reopened.hasAttachmentBlob(a.id))
    }

    func testStoresAndCleansUpAttachments() throws {
        let vault = try Vault(file: try vaultFile(fixtures.typedVault))
        try vault.unlock(fixtures.password)
        let added = try vault.addAttachment(name: "  scan.pdf ", mime: "application/pdf", data: [1, 2, 3])
        XCTAssertEqual("scan.pdf", added.name)
        XCTAssertEqual(3, added.size)
        XCTAssertEqual([1, 2, 3], try vault.decryptAttachment(added))
        // Unsaved attachments survive cleanup until the vault locks
        vault.collectGarbage()
        XCTAssertTrue(vault.hasAttachmentBlob(added.id))
        var input = EntryInput(type: .document)
        input.title = "Scan"
        input.attachments = [added]
        let doc = try vault.createEntry(input)
        XCTAssertEqual([added], doc.attachments)
        XCTAssertNotNil(vault.attachmentRefs()[added.id])

        // Removing it from the entry, then locking, lets cleanup delete the file
        var cleared = EntryInput(doc)
        cleared.attachments = []
        try vault.updateEntry(doc.id, cleared)
        let orphan = try vault.addAttachment(name: "orphan", mime: "text/plain", data: [9])
        vault.lockVault()
        try vault.unlock(fixtures.password)
        XCTAssertFalse(vault.hasAttachmentBlob(added.id))
        XCTAssertFalse(vault.hasAttachmentBlob(orphan.id))
        XCTAssertThrowsError(
            try vault.addAttachment(name: "big", mime: "x", data: [UInt8](repeating: 0, count: Attachment.maxBytes + 1)),
            "oversized files are refused"
        )
    }

    func testMergeTieBreakMatchesDesktop() {
        let cases = fixtures.ties.filter { c in
            ![c.a.notes, c.b.notes, c.a.card?.cardholder ?? "", c.b.card?.cardholder ?? "", c.a.identity?.issuer ?? "", c.b.identity?.issuer ?? ""]
                .contains { $0.contains(Self.loneSurrogate) }
        }
        XCTAssertGreaterThan(cases.count, 20)
        for c in cases {
            let expected = c.winner == "a" ? c.a : c.b
            XCTAssertEqual(expected, pickNewer(c.a, c.b))
            XCTAssertEqual(expected, pickNewer(c.b, c.a))
        }
    }

    func testUrlMatchingMatchesDesktop() {
        let wrong = fixtures.matches.filter { UrlMatch.matchLevel(entryUrl: $0.entryUrl, pageUrl: $0.pageUrl) != $0.level }
        XCTAssertTrue(
            wrong.isEmpty,
            wrong.map {
                "\($0.entryUrl) on \($0.pageUrl): expected \($0.level), got \(UrlMatch.matchLevel(entryUrl: $0.entryUrl, pageUrl: $0.pageUrl))"
            }.joined(separator: "\n")
        )
    }

    func testWritesVaultFilesTheDesktopCanRead() throws {
        // What this app writes decodes to the same file, with the desktop's key order
        let text = fixtures.typedVault.json.text
        XCTAssertEqual(fixtures.typedVault, try JSONDecoder().decode(VaultFile.self, from: Data(text.utf8)))
        XCTAssertTrue(text.hasPrefix("{\"format\":\"pm-vault\",\"version\":1,\"vaultId\":"))
    }
}
