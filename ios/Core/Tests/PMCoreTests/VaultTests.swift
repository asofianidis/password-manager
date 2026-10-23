@testable import PMCore
import XCTest

final class VaultTests: XCTestCase {
    func testMergeKeepsNewestAndAddsNew() {
        let a = VaultEntry(id: "1", title: "old", updatedAt: 1)
        let b = VaultEntry(id: "1", title: "new", updatedAt: 2)
        let c = VaultEntry(id: "2", title: "other", updatedAt: 1)
        let result = mergeEntries([a], [b, c])
        XCTAssertEqual(2, result.changed)
        XCTAssertEqual(["new", "other"], result.entries.map(\.title))
    }

    func testTombstonesWinTies() {
        let live = VaultEntry(id: "1", title: "x", updatedAt: 5)
        let dead = toTombstone(live, now: 5)
        XCTAssertTrue(mergeEntries([live], [dead]).entries.allSatisfy(\.isDeleted))
        XCTAssertTrue(mergeEntries([dead], [live]).entries.allSatisfy(\.isDeleted))
        XCTAssertEqual("", dead.password)
    }

    func testSanitizesInput() {
        var input = EntryInput()
        input.title = "  "
        input.url = " https://x.com "
        input.totp = " "
        input.folder = " f "
        let clean = input.sanitized()
        XCTAssertEqual("Untitled", clean.title)
        XCTAssertEqual("https://x.com", clean.url)
        XCTAssertEqual("", clean.totp)
        XCTAssertEqual("f", clean.folder)
    }

    func testComposesOnlyTheFieldsATypeUses() {
        var input = EntryInput(type: .card)
        input.title = "Visa"
        input.card = CardDetails(cardholder: " Jane ", number: "4242 4242-4242 4242", expiry: "08/27", cvv: "123")
        input.identity = IdentityDetails(fullName: "ignored")
        let card = input.sanitized().compose(id: "1", createdAt: 1, updatedAt: 2, passwordUpdatedAt: 3)
        XCTAssertEqual("card", card.type)
        XCTAssertEqual("Jane", card.card?.cardholder)
        XCTAssertNil(card.identity)
        XCTAssertNil(card.attachments, "no attachments key when there are none")
        XCTAssertEqual(
            "{\"id\":\"1\",\"title\":\"Visa\",\"username\":\"\",\"password\":\"\",\"url\":\"\",\"notes\":\"\",\"totp\":\"\"," +
                "\"folder\":\"\",\"favorite\":false,\"createdAt\":1,\"updatedAt\":2,\"passwordUpdatedAt\":3,\"type\":\"card\"," +
                "\"card\":{\"cardholder\":\"Jane\",\"number\":\"4242424242424242\",\"expiry\":\"08/27\",\"cvv\":\"123\",\"pin\":\"\"}}",
            canonicalJson(card)
        )
        var login = EntryInput()
        login.title = "GitHub"
        XCTAssertTrue(login.sanitized().compose(id: "2", createdAt: 1, updatedAt: 1, passwordUpdatedAt: 1).isLogin)
    }

    func testCleansIdentitiesAndAttachments() {
        let identity = IdentityDetails(kind: "library-card", fullName: " Jane ").sanitized()
        XCTAssertEqual("other", identity.kind)
        XCTAssertEqual("Jane", identity.fullName)
        let ok = Attachment(id: "abcdefgh-1", name: " a.jpg ", mime: "image/jpeg", size: 5, key: "k", createdAt: 0)
        var dup = ok
        dup.name = "dup"
        let cleaned = Attachment.clean([
            ok, dup,
            Attachment(id: "../evil", name: "x", mime: "x", size: 0, key: "k", createdAt: 0),
            Attachment(id: "short", name: "x", mime: "x", size: 0, key: "k", createdAt: 0),
        ])
        var expected = ok
        expected.name = "a.jpg"
        XCTAssertEqual([expected], cleaned)
        let many = (1...25).map { Attachment(id: "attachment-\($0)", name: "a", mime: "b", size: 0, key: "k", createdAt: 0) }
        XCTAssertEqual(20, Attachment.clean(many).count)
    }

    func testTombstonesOfTypedEntriesCarryNothing() {
        var input = EntryInput(type: .document)
        input.title = "Lease"
        input.attachments = [Attachment(id: "abcdefgh-1", name: "a", mime: "b", size: 0, key: "secret", createdAt: 0)]
        let doc = input.sanitized().compose(id: "1", createdAt: 1, updatedAt: 1, passwordUpdatedAt: 1)
        let dead = toTombstone(doc, now: 2)
        XCTAssertNil(dead.type)
        XCTAssertNil(dead.attachments)
        XCTAssertEqual(
            "{\"id\":\"1\",\"title\":\"\",\"username\":\"\",\"password\":\"\",\"url\":\"\",\"notes\":\"\",\"totp\":\"\"," +
                "\"folder\":\"\",\"favorite\":false,\"createdAt\":1,\"updatedAt\":2,\"passwordUpdatedAt\":1,\"deleted\":true}",
            canonicalJson(dead)
        )
    }

    func testEscapesLikeJavaScript() {
        let entry = VaultEntry(id: "x", notes: "q\" b\\ \u{01}\u{1f}\u{08}\u{0c}\n\r\t é 🔑 \u{2028}")
        XCTAssertTrue(canonicalJson(entry).contains("\"notes\":\"q\\\" b\\\\ \\u0001\\u001f\\b\\f\\n\\r\\t é 🔑 \u{2028}\""))
    }

    func testDescribesCards() {
        XCTAssertEqual("Visa", cardBrand("4111"))
        XCTAssertEqual("American Express", cardBrand("378282246310005"))
        XCTAssertEqual("Mastercard", cardBrand("2221000000000009"))
        XCTAssertNil(cardBrand("9999"))
        XCTAssertEqual("3782 822463 10005", formatCardNumber("378282246310005"))
        XCTAssertEqual("4242 4242 4242 4242", formatCardNumber("4242424242424242"))
        XCTAssertEqual("4242 4", formatCardNumber("42424"))
    }

    func testDerivesArgon2idKeys() throws {
        // Unlocking the fixtures checks Argon2 against the desktop; this checks NFKC normalization
        let kdf = KdfParams(algorithm: "argon2id", salt: PMCrypto.b64encode([UInt8](repeating: 7, count: 16)), memoryKiB: 65536, iterations: 3, parallelism: 1)
        let a = try PMCrypto.deriveKey("ﬁ", kdf) // U+FB01, NFKC "fi"
        let b = try PMCrypto.deriveKey("fi", kdf)
        XCTAssertEqual(a, b)
        XCTAssertEqual(32, a.count)
    }

    func testGeneratesPasswords() {
        var options = GeneratorOptions()
        options.length = 30
        options.symbols = false
        let password = Generator.generate(options)
        XCTAssertEqual(30, password.count)
        XCTAssertTrue(password.allSatisfy { $0.isLetter || $0.isNumber })
        options.passphrase = true
        options.words = 4
        options.includeNumber = false
        XCTAssertEqual(4, Generator.generate(options).split(separator: "-").count)
        XCTAssertEqual(7776, Generator.words.count)
    }

    func testFindsRegistrableDomains() {
        XCTAssertEqual("bbc.co.uk", PublicSuffix.registrableDomain("news.bbc.co.uk"))
        XCTAssertNil(PublicSuffix.registrableDomain("github.io"))
        XCTAssertEqual("me.github.io", PublicSuffix.registrableDomain("a.me.github.io"))
        XCTAssertEqual("github.com", UrlMatch.host(of: "www.github.com/login"))
    }
}
