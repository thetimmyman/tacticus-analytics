import XCTest
@testable import TacticusIOS

@MainActor final class DemoWorkspaceTests: XCTestCase {
    private var directory: URL!
    private var store: WorkspaceStore!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("demo-workspace-tests-\(UUID().uuidString)")
        store = try WorkspaceStore(url: directory.appendingPathComponent("workspace.sqlite"))
    }
    override func tearDownWithError() throws { store?.close(); store = nil; try FileManager.default.removeItem(at: directory) }
    private func restartDemo() throws {
        let url = store.url
        store.close(); store = try WorkspaceStore(url: url)
        try store.initializeSyntheticDemo()
    }
    func testFreshSyntheticDemoSeedsCoreAndCacheTogether() throws {
        try store.initializeSyntheticDemo()
        XCTAssertEqual(try store.read(), .demo)
        let cache = try XCTUnwrap(store.playerCache())
        XCTAssertEqual(try cache.portablePlayer(), WorkspaceDocument.demo.player)
        try restartDemo()
        XCTAssertEqual(try store.read(), .demo)
        XCTAssertEqual(try store.playerCache(), cache)
    }
    func testHistoricalPortableImportSurvivesSyntheticDemoRestartWithoutInventedCache() throws {
        var foreign = WorkspaceDocument.demo
        foreign.player?.displayName = "Imported Example"
        var withoutPlayer = WorkspaceDocument.demo; withoutPlayer.player = nil
        for imported in [foreign, WorkspaceDocument.demo, withoutPlayer] {
            try store.importDocument(imported.encoded())
            let history = try store.read()
            XCTAssertEqual(history.mode, "historical")
            XCTAssertNil(try store.playerCache())
            try restartDemo()
            XCTAssertEqual(try store.read(), history)
            XCTAssertNil(try store.playerCache())
        }
    }
    func testExistingSyntheticDemoGainsMatchingCacheWithoutReplacingLocalRaids() throws {
        try store.write(.demo)
        try store.add(RaidRow(player: "Example Player", boss: "Example Boss", damage: 100, tokens: 1, observedAt: 1767225700000))
        let edited = try store.read()
        XCTAssertNil(try store.playerCache())
        try restartDemo()
        XCTAssertEqual(try store.read(), edited)
        XCTAssertEqual(try store.read().totalDamage, 2100)
        let cache = try XCTUnwrap(store.playerCache())
        XCTAssertEqual(try cache.portablePlayer(), edited.player)
        try restartDemo()
        XCTAssertEqual(try store.read(), edited)
        XCTAssertEqual(try store.playerCache(), cache)
    }
    func testHistoricalFullBackupSurvivesSyntheticDemoRestartUnchanged() throws {
        try store.initializeSyntheticDemo()
        let backup = try store.exportBackup()
        try store.importDocument(backup)
        let history = try store.read(), cache = try XCTUnwrap(store.playerCache())
        XCTAssertEqual(history.mode, "historical")
        try restartDemo()
        XCTAssertEqual(try store.read(), history)
        XCTAssertEqual(try store.playerCache(), cache)
    }
}
