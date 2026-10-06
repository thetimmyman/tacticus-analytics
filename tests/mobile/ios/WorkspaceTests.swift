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
    var delayNanoseconds: UInt64 = 0
    var noActiveRaid = false
    init(responses: [OfficialScope: Data]) { self.responses = responses }
    func read(_ scope: OfficialScope, credential: String) async throws -> Data {
        requested.append(scope)
        if scope == .raid && noActiveRaid { throw WorkspaceError.noActiveRaid }
        if delayNanoseconds > 0 { try await Task.sleep(nanoseconds: delayNanoseconds) }
        guard let data = responses[scope] else { throw WorkspaceError.unavailable }; return data
    }
    static func fixtures(guild: String = "synthetic-guild", name: String = "Example Player", expiry: Double = Date().timeIntervalSince1970 + 3600) throws -> [OfficialScope: Data] {
        let metadata: [String: Any] = ["scopes": ["Player", "Guild", "Guild Raid"], "lastUpdatedOn": Int64(Date().timeIntervalSince1970 - 60), "apiKeyExpiresOn": expiry]
        let player: [String: Any] = ["metaData": metadata, "player": ["details": ["name": name], "units": [["id": "synthetic-unit", "name": "Example Unit", "rank": 3, "xpLevel": 10]],
            "progress": ["guildRaid": ["tokens": ["current": 4, "max": 6, "nextTokenInSeconds": 120], "bombTokens": ["current": 2, "max": 3]]]]]
        // Player metadata is not invented on Guild/Raid endpoints. Raid has no guild/event identity.
        let responses: [OfficialScope: [String: Any]] = [.player: player, .guild: ["guild": ["guildId": guild]], .raid: ["season": 1, "seasonConfigId": "synthetic-season", "entries": []]]
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
        let fixture = try XCTUnwrap(Bundle.main.url(forResource: "synthetic-demo", withExtension: "json"))
        XCTAssertEqual(try WorkspaceDocument.decode(Data(contentsOf: fixture)), .demo)
        XCTAssertThrowsError(try store.add(.demo))
        try store.write(.demo)
        XCTAssertEqual(try store.read().totalDamage, 2000)
        XCTAssertEqual(try store.read().totalTokens, 3)
        XCTAssertEqual(try store.read().damagePerToken, 666)
        try store.add(RaidRow(player: "Example Player", boss: "Example Boss", damage: 100, tokens: 1, observedAt: 1767225700000))
        store.close(); try store.open()
        XCTAssertEqual(try store.read().totalDamage, 2100)
        XCTAssertEqual(try store.read().damagePerToken, 525)
        XCTAssertEqual(try store.url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }
    func testPhysicalCompleteFileProtection() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Simulator cannot qualify physical file protection; owner-provisioned device test required")
        #else
        let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
        XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, .complete)
        #endif
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
        let orphan = try vault.save("synthetic-orphan-value")
        try vault.removeOrphans(keeping: [ref])
        do { _ = try await vault.withOfficialRead(orphan) { Data($0.utf8) }; XCTFail("Orphan credential readable") } catch {}
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
    func testNonExpiringKeyNullTokenCountdownAndNoActiveRaidAreAccepted() async throws {
        var player = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(SyntheticOfficialSource.fixtures()[.player])) as? [String: Any])
        var metadata = try XCTUnwrap(player["metaData"] as? [String: Any]); metadata.removeValue(forKey: "apiKeyExpiresOn"); player["metaData"] = metadata
        var body = try XCTUnwrap(player["player"] as? [String: Any]); var progress = try XCTUnwrap(body["progress"] as? [String: Any])
        progress["guildRaid"] = ["tokens": ["current": 6, "max": 6, "nextTokenInSeconds": NSNull()], "bombTokens": ["current": 2, "max": 3]]
        body["progress"] = progress; player["player"] = body
        var responses = try SyntheticOfficialSource.fixtures(); responses[.player] = try JSONSerialization.data(withJSONObject: player)
        let source = SyntheticOfficialSource(responses: responses); source.noActiveRaid = true
        let supervisor = ConnectionSupervisor(store: store, vault: SyntheticVault(), source: source)
        try await supervisor.connect(credential: "synthetic-vault-canary-value") { _, _ in true }
        XCTAssertEqual(try store.read().player?.resources.guildRaidTokens?.current, 6)
        XCTAssertEqual(try store.capabilities().filter { $0.status == "verified-scope" }.count, 3)
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
    func testDisplayMismatchRefusalAndConfirmedReplacementPreserveHistory() async throws {
        let vault = SyntheticVault(); let source = SyntheticOfficialSource(responses: try SyntheticOfficialSource.fixtures())
        let supervisor = ConnectionSupervisor(store: store, vault: vault, source: source)
        try await supervisor.connect(credential: "synthetic-original-value") { _, _ in true }
        try store.add(.demo)
        let original = try store.read()
        source.responses = try SyntheticOfficialSource.fixtures(name: "Different Example")
        var observedPrevious: String?
        do {
            try await supervisor.connect(credential: "synthetic-mismatch-value") { _, previous in observedPrevious = previous; return false }
            XCTFail("Refused replacement activated")
        } catch {}
        XCTAssertEqual(observedPrevious, "Example Player")
        XCTAssertEqual(try store.read(), original)
        try await supervisor.connect(credential: "synthetic-confirmed-value") { _, _ in true }
        XCTAssertEqual(try store.read().player?.displayName, "Different Example")
        XCTAssertEqual(try store.read().raids, original.raids)
        XCTAssertEqual(vault.values.count, 1)
    }
    func testInterruptedSetupRetainsDataAndDoesNotSaveLateCapabilities() async throws {
        try store.write(.demo)
        let vault = SyntheticVault(); let source = SyntheticOfficialSource(responses: try SyntheticOfficialSource.fixtures())
        source.delayNanoseconds = 1_000_000_000
        let supervisor = ConnectionSupervisor(store: store, vault: vault, source: source)
        let operation = Task { try await supervisor.connect(credential: "synthetic-interrupted-value") { _, _ in true } }
        await Task.yield(); operation.cancel()
        do { try await operation.value; XCTFail("Cancelled setup completed") } catch {}
        XCTAssertEqual(try store.read(), .demo)
        XCTAssertTrue(try store.capabilities().isEmpty)
        XCTAssertTrue(vault.values.isEmpty)
        XCTAssertLessThanOrEqual(source.requested.count, 1)
    }
    func testPlayerAndGuildReferenceChangesInvalidateOptionalAccessAndRetainHistory() async throws {
        let vault = SyntheticVault(); let all = try SyntheticOfficialSource.fixtures()
        let source = SyntheticOfficialSource(responses: all)
        let supervisor = ConnectionSupervisor(store: store, vault: vault, source: source)
        try await supervisor.connect(credential: "synthetic-original-value") { _, _ in true }
        try store.add(.demo)
        let history = try store.read().raids
        let original = try XCTUnwrap(store.capabilities().first(where: { $0.scope == .player })?.reference)
        source.responses = [.player: try XCTUnwrap(all[.player])]
        try await supervisor.connect(credential: "synthetic-replacement-value") { _, _ in true }
        XCTAssertNil(try store.capabilities().first(where: { $0.scope == .guild })?.reference)
        XCTAssertNil(try store.capabilities().first(where: { $0.scope == .raid })?.reference)
        XCTAssertNil(vault.values[original])
        XCTAssertEqual(try store.read().raids, history)
        source.responses = all
        try await supervisor.connect(credential: "synthetic-optional-original", requestPlayer: false) { _, _ in false }
        let oldRaid = try XCTUnwrap(store.capabilities().first(where: { $0.scope == .raid })?.reference)
        source.responses = [.guild: try XCTUnwrap(all[.guild])]
        try await supervisor.connect(credential: "synthetic-guild-replacement", requestPlayer: false) { _, _ in false }
        XCTAssertNil(try store.capabilities().first(where: { $0.scope == .raid })?.reference)
        XCTAssertNil(vault.values[oldRaid])
        source.responses = all
        try await supervisor.connect(credential: "synthetic-optional-combined", requestPlayer: false) { _, _ in false }
        try supervisor.disconnect(.guild)
        XCTAssertNil(try store.capabilities().first(where: { $0.scope == .raid })?.reference)
        XCTAssertNil(try store.capabilities().first(where: { $0.scope == .guild })?.guild)
        source.responses = try SyntheticOfficialSource.fixtures(guild: "new-synthetic-guild")
        try await supervisor.connect(credential: "synthetic-new-guild", requestPlayer: false) { _, _ in false }
        XCTAssertEqual(try store.capabilities().first(where: { $0.scope == .guild })?.guild, "new-synthetic-guild")
        try supervisor.disconnect(.player)
        XCTAssertTrue(try store.capabilities().allSatisfy { $0.reference == nil })
        XCTAssertTrue(vault.values.isEmpty)
        XCTAssertEqual(try store.read().raids, history)
    }
}

private extension RaidRow {
    static let demo = RaidRow(player: "Example Player", boss: "Example Boss", damage: 10, tokens: 1, observedAt: 1767225600000)
}
