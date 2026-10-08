import Foundation
import CoreFoundation

protocol OfficialSource {
    func read(_ scope: OfficialScope, credential: String) async throws -> Data
}
private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
final class DeviceOfficialSource: OfficialSource {
    private let delegate = NoRedirect()
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 20
        configuration.httpMaximumConnectionsPerHost = 2
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    func read(_ scope: OfficialScope, credential: String) async throws -> Data {
        try Task.checkCancellation()
        let url = URL(string: "https://api.tacticusgame.com/api/v1/\(scope.path)")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(credential, forHTTPHeaderField: "X-API-KEY")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        if scope == .raid, let missing = response as? HTTPURLResponse, missing.statusCode == 404,
           missing.url?.scheme == "https", missing.url?.host == "api.tacticusgame.com" {
            // An authenticated 404 means the key has the scope but no raid is active.
            throw WorkspaceError.noActiveRaid
        }
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.url?.scheme == "https", response.url?.host == "api.tacticusgame.com",
              response.expectedContentLength <= 4 * 1024 * 1024 else { throw WorkspaceError.scope }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < 4 * 1024 * 1024 else { throw WorkspaceError.scope }
            data.append(byte)
        }
        return data
    }
}

@MainActor final class ConnectionSupervisor {
    let store: WorkspaceStore
    let vault: OfficialCredentialVault
    let source: OfficialSource
    private var busy = false
    init(store: WorkspaceStore, vault: OfficialCredentialVault, source: OfficialSource) {
        self.store = store; self.vault = vault; self.source = source
    }
    func connect(credential: String?, reuse: String? = nil, requestPlayer: Bool = true,
                 confirm: (String, String?) async -> Bool) async throws {
        try Task.checkCancellation()
        guard !busy else { throw WorkspaceError.unavailable }
        busy = true
        defer { busy = false }
        let previous = try store.capabilities()
        let oldDocument = try store.read()
        let reference: String
        if let reuse { reference = reuse }
        else if let credential { reference = try vault.save(credential) }
        else { throw WorkspaceError.credential }
        var document = oldDocument
        var updated: [CapabilityState] = []
        var projectedPlayer: PlayerSnapshot?
        var projectedCache: PlayerCache?
        var guild: String?
        var keyExpired = false
        var playerReferenceChanged = false
        func read(_ scope: OfficialScope) async throws -> [String: Any] {
            try Task.checkCancellation()
            guard !keyExpired else { throw WorkspaceError.scope }
            let data = try await vault.withOfficialRead(reference) { secret in
                let raw = try await self.source.read(scope, credential: secret)
                guard let value = try JSONSerialization.jsonObject(with: raw) as? [String: Any] else { throw WorkspaceError.scope }
                if let metadata = value["metaData"] as? [String: Any] {
                    if let scopes = metadata["scopes"] {
                        guard (scopes as? [String])?.contains(scope.rawValue) == true else { throw WorkspaceError.scope }
                    } else if scope == .player { throw WorkspaceError.scope }
                    // Non-expiring keys omit the expiry or report null; only a present value is checked.
                    if let expiryValue = metadata["apiKeyExpiresOn"], !(expiryValue is NSNull) {
                        guard let expiry = expiryValue as? NSNumber, CFGetTypeID(expiry) != CFBooleanGetTypeID(), expiry.doubleValue.isFinite else { throw WorkspaceError.scope }
                        if expiry.doubleValue <= Date().timeIntervalSince1970 { keyExpired = true; throw WorkspaceError.scope }
                    }
                } else if scope == .player || value["metaData"] != nil { throw WorkspaceError.scope }
                let projection: [String: Any]
                if scope == .player { projection = try PlayerCache.project(value).object }
                else if scope == .guild { projection = ["guildId": (value["guild"] as? [String: Any])?["guildId"] ?? NSNull()] }
                else { projection = ["season": value["season"] ?? NSNull()] }
                try SecretGuard.check(try JSONSerialization.data(withJSONObject: projection), credential: secret)
                return raw
            }
            try Task.checkCancellation()
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw WorkspaceError.scope }
            return object
        }
        do {
            if requestPlayer {
                do {
                    let value = try await read(.player)
                    let cache = try PlayerCache.project(value)
                    let candidate = try cache.portablePlayer()
                    guard await confirm(candidate.displayName, oldDocument.player?.displayName) else { throw WorkspaceError.cancelled }
                    projectedPlayer = candidate; projectedCache = cache
                    playerReferenceChanged = previous.first(where: { $0.scope == .player })?.reference != reference
                    document.player = candidate; document.mode = "personal"
                    updated.append(CapabilityState(scope: .player, reference: reference, status: "verified-scope", guild: nil))
                } catch {
                    updated.append(CapabilityState(scope: .player, reference: previous.first(where: { $0.scope == .player })?.reference,
                        status: oldDocument.player == nil ? "player-required" : "refresh-unavailable-offline-readable", guild: nil))
                }
            }
            do {
                let value = try await read(.guild)
                guard let identifier = (value["guild"] as? [String: Any])?["guildId"] as? String, !identifier.isEmpty, identifier.count <= 100 else { throw WorkspaceError.scope }
                if !playerReferenceChanged, let expected = previous.first(where: { $0.scope == .guild })?.guild, expected != identifier { throw WorkspaceError.scope }
                guild = identifier
                updated.append(CapabilityState(scope: .guild, reference: reference, status: "verified-scope", guild: identifier))
            } catch {
                let prior = playerReferenceChanged ? nil : previous.first(where: { $0.scope == .guild })
                updated.append(CapabilityState(scope: .guild, reference: prior?.reference, status: playerReferenceChanged ? "player-changed-reverification-required" : "unavailable-or-wrong-guild", guild: prior?.guild))
            }
            if let guild {
                do {
                    let value = try await read(.raid)
                    guard let season = value["season"] as? NSNumber, CFGetTypeID(season) != CFBooleanGetTypeID(),
                          season.doubleValue >= 0, season.doubleValue.rounded() == season.doubleValue,
                          let entries = value["entries"] as? [Any], entries.count <= 10_000 else { throw WorkspaceError.scope }
                    updated.append(CapabilityState(scope: .raid, reference: reference, status: "verified-scope", guild: guild))
                } catch WorkspaceError.noActiveRaid {
                    updated.append(CapabilityState(scope: .raid, reference: reference, status: "verified-scope", guild: guild))
                } catch { updated.append(CapabilityState(scope: .raid, reference: nil, status: "unavailable", guild: nil)) }
            } else { updated.append(CapabilityState(scope: .raid, reference: nil, status: "guild-binding-unavailable", guild: nil)) }
            try Task.checkCancellation()
            try store.transaction {
                if projectedPlayer != nil {
                    // Re-read local rows at commit: a delayed refresh cannot overwrite a local edit.
                    document.raids = try store.read().raids
                    try store.write(document); try store.writePlayerCache(projectedCache)
                }
                for state in updated { try store.setCapability(state) }
            }
            let references = Set(try store.capabilities().compactMap(\.reference))
            // The workspace is committed; unreachable credentials are removed best-effort and never undo it.
            if !references.contains(reference) { try? vault.remove(reference) }
            for old in Set(previous.compactMap(\.reference)) where !references.contains(old) { try? vault.remove(old) }
            if requestPlayer && projectedPlayer == nil { throw WorkspaceError.scope }
        } catch {
            let retained = Set((try? store.capabilities())?.compactMap(\.reference) ?? [])
            if !retained.contains(reference) { try? vault.remove(reference) }
            throw error
        }
    }
    func disconnect(_ scope: OfficialScope) throws {
        let previous = try store.capabilities()
        try store.transaction {
            try store.setCapability(CapabilityState(scope: scope, reference: nil, status: "disconnected-offline-readable", guild: nil))
            if scope == .player {
                try store.setCapability(CapabilityState(scope: .guild, reference: nil, status: "player-required", guild: nil))
            }
            if scope == .guild || scope == .player { try store.setCapability(CapabilityState(scope: .raid, reference: nil, status: "guild-binding-unavailable", guild: nil)) }
        }
        let retained = Set(try store.capabilities().compactMap(\.reference))
        for reference in Set(previous.compactMap(\.reference)) where !retained.contains(reference) { try vault.remove(reference) }
    }
}
