import Foundation
import PMCore
import XCTest

/**
 * Pairs and syncs with a real desktop: the headless peer from android/scripts/desktop-peer.test.ts.
 * Skipped unless PM_PEER_HOST and PM_PEER_CODE are set:
 *
 *   PM_PEER_HOST=127.0.0.1 PM_PEER_CODE=123456 swift test --filter LivePeerTests
 */
final class LivePeerTests: XCTestCase {
    func testPairsAndSyncsWithTheDesktop() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let host = env["PM_PEER_HOST"], let code = env["PM_PEER_CODE"] else {
            throw XCTSkip("PM_PEER_HOST and PM_PEER_CODE are not set")
        }
        let port = Int(env["PM_PEER_PORT"] ?? "") ?? 47999
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pm-live-\(UUID().uuidString)")
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let vault = try Vault(file: dir.appendingPathComponent("vault.json"))
        let client = SyncClient(vault: vault, deviceId: { "ios-live-test" }, deviceName: { "iOS test" })

        let hello = try await client.hello(host: host, port: port)
        XCTAssertEqual("pm", hello.app)
        let paired = try await client.pair(host: host, port: port, code: code)
        try vault.join(vaultId: paired.vaultId, header: paired.header, masterPassword: "correct horse battery staple")

        _ = try await client.sync(peerName: paired.deviceName, host: host, port: port)
        let titles = Set(try vault.list().map(\.title))
        XCTAssertTrue(titles.isSuperset(of: ["GitHub", "Everyday Visa", "Home address", "Passport"]), "\(titles)")
        let passport = try XCTUnwrap(try vault.list().first { $0.title == "Passport" })
        let photo = try XCTUnwrap(passport.attachments?.first)
        XCTAssertEqual("passport.png", photo.name)
        XCTAssertEqual(photo.size, Int64(try XCTUnwrap(try vault.decryptAttachment(photo)).count))

        // A change made here, with a file, reaches the desktop
        let file = try vault.addAttachment(name: "from-ios.txt", mime: "text/plain", data: Array("hello from iOS".utf8))
        var input = EntryInput(type: .document)
        input.title = "Made on iOS"
        input.attachments = [file]
        try vault.createEntry(input)
        let outcome = try await client.sync(peerName: paired.deviceName, host: host, port: port)
        XCTAssertEqual(0, outcome.received)
        print("Synced \(outcome.sent) records; check the desktop peer's log for \"Made on iOS\" and its file")
    }
}
