import XCTest
import SQLite3
@testable import TacticusIOS

private final class SyntheticVault: OfficialCredentialVault {
    var values: [String: String] = [:]
    func save(_ credential: String) throws -> String { let ref = UUID().uuidString; values[ref] = credential; return ref }
    func withOfficialRead(_ reference: String, operation: (String) async throws -> Data) async throws -> Data {
        guard let value = values[reference] else { throw WorkspaceError.credential }; return try await operation(value)
    }
    func remove(_ reference: String) throws { values.removeValue(forKey: reference) }
}
private final class SyntheticOfficialSource: OfficialSource {
    var responses: [OfficialScope: Data]
    var requested: [OfficialScope] = []
    init(responses: [OfficialScope: Data]) { self.responses = responses }
    func read(_ scope: OfficialScope, credential: String) async throws -> Data {
        requested.append(scope)
        guard let data = responses[scope] else { throw WorkspaceError.unavailable }; return data
    }
    static func fixtures(guild: String = "synthetic-guild", name: String = "Example Player", expiry: Double = Date().timeIntervalSince1970 + 3600) throws -> [OfficialScope: Data] {
        let metadata: [String: Any] = ["scopes": ["Player", "Guild", "Guild Raid"], "lastUpdatedOn": Int64(Date().timeIntervalSince1970 - 60), "apiKeyExpiresOn": expiry]
        let player: [String: Any] = ["metaData": metadata, "player": ["details": ["name": name], "units": [["id": "synthetic-unit", "name": "Example Unit", "rank": 3, "xpLevel": 10]],
            "progress": ["guildRaid": ["tokens": ["current": 4, "max": 6, "nextTokenInSeconds": 120], "bombTokens": ["current": 2, "max": 3]]]]]
        let responses: [OfficialScope: [String: Any]] = [.player: player, .guild: ["metaData": metadata, "guild": ["guildId": guild]], .raid: ["metaData": metadata, "season": 1, "entries": []]]
        return try responses.mapValues { try JSONSerialization.data(withJSONObject: $0) }
    }
}

@MainActor final class WorkspaceTests: XCTestCase {
    private var directory: URL!
    private var store: WorkspaceStore!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("workspace-tests-\(UUID().uuidString)")
        store = try WorkspaceStore(url: directory.appendingPathComponent("workspace.sqlite"))
    }
    override func tearDownWithError() throws { store?.close(); store = nil; try FileManager.default.removeItem(at: directory) }
    func testOfflineSQLiteCalculationAndReopen() throws {
        XCTAssertThrowsError(try store.add(.demo))
        try store.write(.demo)
        XCTAssertEqual(try store.read().totalDamage, 2000)
        XCTAssertEqual(try store.read().totalTokens, 3)
        XCTAssertEqual(try store.read().damagePerToken, 666)
        try store.add(RaidRow(player: "Example Player", boss: "Example Boss", damage: 100, tokens: 1, observedAt: 1767225700000))
        store.close(); try store.open()
        XCTAssertEqual(try store.read().totalDamage, 2100)
        XCTAssertEqual(try store.read().damagePerToken, 525)
        let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
        XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, .complete)
        XCTAssertEqual(try store.url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }
    func testStrictScopedImportAndExportDoNotActivateOrCarrySecrets() throws {
        let vault = SyntheticVault(); let ref = try vault.save("synthetic-vault-canary-value")
        try store.write(.demo)
        try store.setCapability(CapabilityState(scope: .player, reference: ref, status: "verified-scope", guild: nil))
        try store.setConsent(purpose: .meta, dataset: .raid, enabled: true)
        try store.stageContribution(purpose: .meta, dataset: .raid)
        let exported = try store.exportDocument()
        XCTAssertFalse(String(decoding: exported, as: UTF8.self).contains(ref))
        XCTAssertFalse(String(decoding: exported, as: UTF8.self).contains("synthetic-vault-canary-value"))
        var invalid = try XCTUnwrap(JSONSerialization.jsonObject(with: exported) as? [String: Any])
        invalid["credential"] = "synthetic-vault-canary-value"
        XCTAssertThrowsError(try store.importDocument(JSONSerialization.data(withJSONObject: invalid)))
        XCTAssertEqual(try store.read(), .demo)
        XCTAssertEqual(try store.queuedCount(), 1)
        try store.importDocument(exported)
        XCTAssertEqual(try store.read().mode, "historical")
        XCTAssertTrue(try store.capabilities().isEmpty)
        XCTAssertFalse(try store.consent(purpose: .meta, dataset: .raid).enabled)
        XCTAssertEqual(try store.queuedCount(), 0)
        invalid.removeValue(forKey: "credential"); invalid["schemaVersion"] = "mobile-workspace/v2"
        XCTAssertThrowsError(try store.importDocument(JSONSerialization.data(withJSONObject: invalid)))
    }
    func testMigrationRollbackAndFutureVersionPreserveFiles() throws {
        let migration = directory.appendingPathComponent("migration.sqlite")
        XCTAssertThrowsError(try WorkspaceStore(url: migration, failMigration: true))
        let repaired = try WorkspaceStore(url: migration); repaired.close()
        var database: OpaquePointer?
        XCTAssertEqual(sqlite3_open(migration.path, &database), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(database, "PRAGMA user_version=9", nil, nil, nil), SQLITE_OK)
        sqlite3_close(database)
        let original = try Data(contentsOf: migration)
        XCTAssertThrowsError(try WorkspaceStore(url: migration))
        XCTAssertEqual(try Data(contentsOf: migration), original)
    }
    func testActualSQLiteFullRollbackRetainsPreviousDocument() throws {
        try store.write(.demo)
        let bytes = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: store.url.path)[.size] as? NSNumber)
        try store.limitStorage(pages: (bytes.int64Value + 4095) / 4096)
        var large = WorkspaceDocument.demo
        large.raids = Array(repeating: RaidRow(player: "Example Player", boss: String(repeating: "B", count: 80), damage: 42, tokens: 1, observedAt: 1767225600000), count: 3000)
        XCTAssertThrowsError(try store.transaction { try store.write(large) })
        XCTAssertEqual(try store.read(), .demo)
        store.close(); try store.open(); XCTAssertEqual(try store.read(), .demo)
    }
    func testConsentPurposesAreIndependentAndRevocationPurgesQueue() throws {
        try store.write(.demo)
        for purpose in ContributionPurpose.allCases { for dataset in ContributionDataset.allCases { XCTAssertFalse(try store.consent(purpose: purpose, dataset: dataset).enabled) } }
        XCTAssertThrowsError(try store.stageContribution(purpose: .meta, dataset: .raid))
        try store.setConsent(purpose: .meta, dataset: .raid, enabled: true)
        try store.stageContribution(purpose: .meta, dataset: .raid)
        XCTAssertFalse(try store.consent(purpose: .portal, dataset: .raid).enabled)
        XCTAssertThrowsError(try store.stageContribution(purpose: .meta, dataset: .war))
        let generation = try store.consent(purpose: .meta, dataset: .raid).generation
        try store.setConsent(purpose: .meta, dataset: .raid, enabled: false)
        XCTAssertEqual(try store.queuedCount(), 0)
        XCTAssertGreaterThan(try store.consent(purpose: .meta, dataset: .raid).generation, generation)
    }
    func testRealSimulatorKeychainCRUDAndCanaryGuard() async throws {
        let vault = CredentialVault(); let value = "synthetic-vault-canary-value"
        let ref = try vault.save(value); defer { try? vault.remove(ref) }
        let actual = try await vault.withOfficialRead(ref) { Data($0.utf8) }
        XCTAssertEqual(actual, Data(value.utf8))
        for encoded in [value, Data(value.utf8).base64EncodedString(), Data(value.utf8).map { String(format: "%02x", $0) }.joined()] {
            XCTAssertThrowsError(try SecretGuard.check(Data(encoded.utf8), credential: value))
        }
        try vault.remove(ref)
        do { _ = try await vault.withOfficialRead(ref) { Data($0.utf8) }; XCTFail("Deleted credential readable") } catch {}
    }
    func testAllThreeSyntheticScopesReuseOneReferenceAndRealShapeProjection() async throws {
        let vault = SyntheticVault(); let source = SyntheticOfficialSource(responses: try SyntheticOfficialSource.fixtures())
        let supervisor = ConnectionSupervisor(store: store, vault: vault, source: source)
        try await supervisor.connect(credential: "synthetic-vault-canary-value") { name, _ in name == "Example Player" }
        XCTAssertEqual(Set(source.requested), Set(OfficialScope.allCases))
        let states = try store.capabilities()
        XCTAssertEqual(Set(states.compactMap(\.reference)).count, 1)
        XCTAssertEqual(states.filter { $0.status == "verified-scope" }.count, 3)
        XCTAssertEqual(try store.read().player?.resources.guildRaidTokens?.current, 4)
        XCTAssertEqual(try store.read().player?.resources.bombTokens?.current, 2)
        XCTAssertEqual(try store.read().player?.units.first?.name, "Example Unit")
        XCTAssertEqual(try store.read().mode, "personal")
        let exported = String(decoding: try store.exportDocument(), as: UTF8.self)
        XCTAssertFalse(exported.contains("synthetic-vault-canary-value")); XCTAssertFalse(exported.contains("guildId")); XCTAssertFalse(exported.contains("stablePlayerID"))
    }
    func testPlayerOnlySeparateOptionalKeysWrongGuildAndOfflineRetention() async throws {
        let vault = SyntheticVault(); let fixtures = try SyntheticOfficialSource.fixtures()
        let source = SyntheticOfficialSource(responses: [.player: try XCTUnwrap(fixtures[.player])])
        let supervisor = ConnectionSupervisor(store: store, vault: vault, source: source)
        try await supervisor.connect(credential: "synthetic-player-value") { _, _ in true }
        let playerRef = try XCTUnwrap(store.capabilities().first(where: { $0.scope == .player })?.reference)
        source.responses = [.guild: try XCTUnwrap(fixtures[.guild]), .raid: try XCTUnwrap(fixtures[.raid])]
        try await supervisor.connect(credential: "synthetic-optional-value", requestPlayer: false) { _, _ in false }
        XCTAssertEqual(Set(try store.capabilities().compactMap(\.reference)).count, 2)
        let prior = try store.read()
        source.responses = try SyntheticOfficialSource.fixtures(guild: "other-synthetic-guild")
        try await supervisor.connect(credential: "synthetic-wrong-guild", requestPlayer: false) { _, _ in false }
        XCTAssertEqual(try store.capabilities().first(where: { $0.scope == .guild })?.status, "unavailable-or-wrong-guild")
        source.responses = [:]
        do { try await supervisor.connect(credential: nil, reuse: playerRef) { _, _ in true }; XCTFail("Offline Player verified") } catch {}
        XCTAssertEqual(try store.read(), prior)
        XCTAssertEqual(try store.capabilities().first(where: { $0.scope == .player })?.status, "refresh-unavailable-offline-readable")
        try supervisor.disconnect(.player)
        XCTAssertEqual(try store.read(), prior)
    }
    func testRefusalExpiryRaidOnlyAndCredentialEchoNeverActivatePlayer() async throws {
        let vault = SyntheticVault(); let source = SyntheticOfficialSource(responses: try SyntheticOfficialSource.fixtures())
        let supervisor = ConnectionSupervisor(store: store, vault: vault, source: source)
        do { try await supervisor.connect(credential: "synthetic-refused-value") { _, _ in false }; XCTFail("Refused display activated") } catch {}
        XCTAssertNil(try store.read().player)
        source.responses = try SyntheticOfficialSource.fixtures(expiry: 1)
        do { try await supervisor.connect(credential: "synthetic-expired-value") { _, _ in true }; XCTFail("Expired key activated") } catch {}
        XCTAssertNil(try store.read().player)
        source.responses = [.raid: try XCTUnwrap(SyntheticOfficialSource.fixtures()[.raid])]
        try await supervisor.connect(credential: "synthetic-raid-only-value", requestPlayer: false) { _, _ in true }
        XCTAssertNil(try store.read().player)
        XCTAssertEqual(try store.capabilities().first(where: { $0.scope == .raid })?.status, "guild-binding-unavailable")
        source.responses = try SyntheticOfficialSource.fixtures(name: "synthetic-echo-canary-value")
        do { try await supervisor.connect(credential: "synthetic-echo-canary-value") { _, _ in true }; XCTFail("Credential echo persisted") } catch {}
        XCTAssertNil(try store.read().player)
        XCTAssertFalse(String(decoding: try store.exportDocument(), as: UTF8.self).contains("synthetic-echo-canary-value"))
    }
}

private extension RaidRow {
    static let demo = RaidRow(player: "Example Player", boss: "Example Boss", damage: 10, tokens: 1, observedAt: 1767225600000)
}
