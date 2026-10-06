import Foundation
import SQLite3

final class WorkspaceStore {
    let url: URL
    private var database: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(url: URL, failMigration: Bool = false) throws {
        self.url = url
        try open(failMigration: failMigration)
    }
    static func applicationURL(demo: Bool = false) throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let folder = base.appendingPathComponent("MobileWorkspace", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete])
        var protected = folder
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try protected.setResourceValues(values)
        return folder.appendingPathComponent(demo ? "synthetic-demo.sqlite" : "workspace.sqlite")
    }
    func open(failMigration: Bool = false) throws {
        if database != nil { return }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete])
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            close(); throw WorkspaceError.storage
        }
        do {
            sqlite3_busy_timeout(database, 1000)
            let version = try scalar("PRAGMA user_version")
            guard version <= 1 else { throw WorkspaceError.incompatibleSchema }
            try execute("PRAGMA journal_mode=DELETE")
            try execute("PRAGMA synchronous=FULL")
            if version == 0 {
                try transaction {
                    try execute("CREATE TABLE document(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)")
                    try execute("CREATE TABLE capability(scope TEXT PRIMARY KEY, reference TEXT, status TEXT NOT NULL, guild TEXT)")
                    try execute("CREATE TABLE consent(purpose TEXT NOT NULL, dataset TEXT NOT NULL, enabled INTEGER NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY(purpose,dataset))")
                    try execute("CREATE TABLE contribution_queue(id TEXT PRIMARY KEY, purpose TEXT NOT NULL, dataset TEXT NOT NULL, generation INTEGER NOT NULL, payload TEXT NOT NULL)")
                    if failMigration { try execute("INSERT INTO nonexistent_migration_control VALUES(1)") }
                    try execute("PRAGMA user_version=1")
                }
            }
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
            var protected = url; var values = URLResourceValues(); values.isExcludedFromBackup = true
            try protected.setResourceValues(values)
        } catch { close(); throw error }
    }
    func close() { if let database { sqlite3_close_v2(database) }; database = nil }
    deinit { close() }
    private func execute(_ sql: String) throws {
        guard let database, sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw WorkspaceError.storage }
    }
    func transaction(_ action: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do { try action(); try execute("COMMIT") } catch { try? execute("ROLLBACK"); throw error }
    }
    private func statement(_ sql: String, values: [String?] = [], action: (OpaquePointer) throws -> Void) throws {
        guard let database else { throw WorkspaceError.storage }
        var prepared: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &prepared, nil) == SQLITE_OK, let prepared else { throw WorkspaceError.storage }
        defer { sqlite3_finalize(prepared) }
        for (index, value) in values.enumerated() {
            if let value { sqlite3_bind_text(prepared, Int32(index + 1), value, -1, transient) }
            else { sqlite3_bind_null(prepared, Int32(index + 1)) }
        }
        try action(prepared)
    }
    private func text(_ statement: OpaquePointer, _ column: Int32) -> String? {
        guard let value = sqlite3_column_text(statement, column) else { return nil }
        return String(cString: value)
    }
    private func scalar(_ sql: String, values: [String?] = []) throws -> Int64 {
        var result: Int64 = 0
        try statement(sql, values: values) { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else { throw WorkspaceError.storage }
            result = sqlite3_column_int64(statement, 0)
        }
        return result
    }
    func read() throws -> WorkspaceDocument {
        var data: Data?
        try statement("SELECT payload FROM document WHERE id=1") { statement in
            let status = sqlite3_step(statement)
            if status == SQLITE_ROW, let value = text(statement, 0) { data = value.data(using: .utf8) }
            else if status != SQLITE_DONE { throw WorkspaceError.storage }
        }
        return try data.map(WorkspaceDocument.decode) ?? .empty
    }
    func write(_ document: WorkspaceDocument) throws {
        guard let payload = String(data: try document.encoded(), encoding: .utf8) else { throw WorkspaceError.invalidDocument }
        try statement("INSERT INTO document(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", values: [payload]) {
            guard sqlite3_step($0) == SQLITE_DONE else { throw WorkspaceError.storage }
        }
    }
    func add(_ row: RaidRow) throws {
        try transaction {
            var document = try read()
            guard document.mode != "personal" || document.player != nil else { throw WorkspaceError.scope }
            document.raids.append(row); try write(document)
        }
    }
    func limitStorage(pages: Int64) throws {
        guard pages > 0, pages <= 1_000_000 else { throw WorkspaceError.storage }
        try execute("PRAGMA max_page_count=\(pages)")
    }
    func importDocument(_ data: Data) throws {
        var document = try WorkspaceDocument.decode(data)
        document.mode = "historical"
        try transaction {
            try write(document)
            try execute("DELETE FROM capability")
            try execute("DELETE FROM contribution_queue")
            try execute("UPDATE consent SET enabled=0,generation=generation+1")
        }
    }
    func exportDocument() throws -> Data { try read().encoded() }
    func capabilities() throws -> [CapabilityState] {
        var states: [CapabilityState] = []
        try statement("SELECT scope,reference,status,guild FROM capability") { statement in
            while true {
                let status = sqlite3_step(statement)
                if status == SQLITE_DONE { break }
                guard status == SQLITE_ROW, let scope = text(statement, 0).flatMap(OfficialScope.init(rawValue:)) else { throw WorkspaceError.storage }
                states.append(CapabilityState(scope: scope, reference: text(statement, 1), status: text(statement, 2) ?? "unavailable", guild: text(statement, 3)))
            }
        }
        return states
    }
    func setCapability(_ state: CapabilityState) throws {
        try statement("INSERT INTO capability(scope,reference,status,guild) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET reference=excluded.reference,status=excluded.status,guild=excluded.guild",
                      values: [state.scope.rawValue, state.reference, state.status, state.guild]) {
            guard sqlite3_step($0) == SQLITE_DONE else { throw WorkspaceError.storage }
        }
    }
    func consent(purpose: ContributionPurpose, dataset: ContributionDataset) throws -> (enabled: Bool, generation: Int64) {
        var result = (false, Int64(0))
        try statement("SELECT enabled,generation FROM consent WHERE purpose=? AND dataset=?", values: [purpose.rawValue, dataset.rawValue]) { statement in
            let status = sqlite3_step(statement)
            if status == SQLITE_ROW { result = (sqlite3_column_int(statement, 0) == 1, sqlite3_column_int64(statement, 1)) }
            else if status != SQLITE_DONE { throw WorkspaceError.storage }
        }
        return result
    }
    func setConsent(purpose: ContributionPurpose, dataset: ContributionDataset, enabled: Bool) throws {
        try transaction {
            try statement("INSERT INTO consent(purpose,dataset,enabled,generation) VALUES(?,?,?,1) ON CONFLICT(purpose,dataset) DO UPDATE SET enabled=excluded.enabled,generation=consent.generation+1", values: [purpose.rawValue, dataset.rawValue, enabled ? "1" : "0"]) {
                guard sqlite3_step($0) == SQLITE_DONE else { throw WorkspaceError.storage }
            }
            try statement("DELETE FROM contribution_queue WHERE purpose=? AND dataset=?", values: [purpose.rawValue, dataset.rawValue]) {
                guard sqlite3_step($0) == SQLITE_DONE else { throw WorkspaceError.storage }
            }
        }
    }
    func stageContribution(purpose: ContributionPurpose, dataset: ContributionDataset) throws {
        guard dataset == .raid else { throw WorkspaceError.unavailable }
        try transaction {
            let policy = try consent(purpose: purpose, dataset: dataset)
            guard policy.enabled else { throw WorkspaceError.scope }
            // Staging is local only; a reviewed binding/envelope and transport are still required.
            let payload = String(data: try exportDocument(), encoding: .utf8)
            try statement("INSERT INTO contribution_queue(id,purpose,dataset,generation,payload) VALUES(?,?,?,?,?)",
                values: [UUID().uuidString, purpose.rawValue, dataset.rawValue, String(policy.generation), payload]) {
                guard sqlite3_step($0) == SQLITE_DONE else { throw WorkspaceError.storage }
            }
        }
    }
    func queuedCount() throws -> Int64 { try scalar("SELECT count(*) FROM contribution_queue") }
}
