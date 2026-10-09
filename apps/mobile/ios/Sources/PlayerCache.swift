import Foundation
import CoreFoundation

// The bundled rules are the canonical public projection, not a second field list.
// Unknown upstream fields are discarded; stored and imported projections are strict.
struct PlayerCache: Equatable {
    let data: Data
    static let limit = 4 * 1024 * 1024
    var object: [String: Any] { (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:] }
    var player: [String: Any] { object["player"] as? [String: Any] ?? [:] }

    static func project(_ response: [String: Any]) throws -> PlayerCache {
        guard let metadata = response["metaData"] as? [String: Any],
              (metadata["scopes"] as? [String])?.contains("Player") == true,
              let player = response["player"] as? [String: Any] else { throw WorkspaceError.scope }
        return try create(player: player, updatedOn: metadata["lastUpdatedOn"] ?? NSNull(), strict: false)
    }
    static func decode(_ data: Data) throws -> PlayerCache {
        guard data.count <= limit,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(value.keys) == ["schemaVersion", "player", "updatedOn"],
              value["schemaVersion"] as? String == "official-player-cache/v1",
              let player = value["player"] as? [String: Any] else { throw WorkspaceError.invalidDocument }
        return try create(player: player, updatedOn: value["updatedOn"] ?? NSNull(), strict: true)
    }
    private static func create(player: [String: Any], updatedOn: Any, strict: Bool) throws -> PlayerCache {
        guard let updated = updatedOn as? NSNumber, CFGetTypeID(updated) != CFBooleanGetTypeID(),
              updated.doubleValue.isFinite, updated.doubleValue.rounded() == updated.doubleValue,
              updated.doubleValue >= 0, updated.doubleValue <= 9_007_199_254_740,
              let url = Bundle.main.url(forResource: "player-schema", withExtension: "json"),
              let schema = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
              let definitions = schema["definitions"] as? [String: [String: Any]], let root = definitions["Player"] else { throw WorkspaceError.invalidDocument }
        let projected = try projectValue(player, rule: root, definitions: definitions, depth: 0)
        let canonical = try JSONSerialization.data(withJSONObject: projected, options: [.sortedKeys])
        if strict, canonical != (try JSONSerialization.data(withJSONObject: player, options: [.sortedKeys])) { throw WorkspaceError.invalidDocument }
        let bytes = try JSONSerialization.data(withJSONObject: ["schemaVersion": "official-player-cache/v1", "updatedOn": updated, "player": projected], options: [.sortedKeys])
        guard bytes.count <= limit else { throw WorkspaceError.invalidDocument }
        let cache = PlayerCache(data: bytes)
        _ = try cache.portablePlayer()
        return cache
    }
    private static func projectValue(_ value: Any, rule: [String: Any], definitions: [String: [String: Any]], depth: Int) throws -> Any {
        guard depth <= 16 else { throw WorkspaceError.invalidDocument }
        if let ref = rule["$ref"] as? String, let target = definitions[ref] {
            return try projectValue(value, rule: target, definitions: definitions, depth: depth + 1)
        }
        switch rule["type"] as? String {
        case "object":
            guard let value = value as? [String: Any], value.count <= 10_000,
                  (rule["required"] as? [String] ?? []).allSatisfy({ value[$0] != nil }) else { throw WorkspaceError.invalidDocument }
            let properties = rule["properties"] as? [String: [String: Any]] ?? [:]
            var output: [String: Any] = [:]
            for (key, entry) in value {
                let normalized = key.lowercased().filter { $0.isLetter || $0.isNumber }
                if ["proto", "constructor", "prototype", "apikey", "credential", "secret", "authorization", "headers", "cookie", "sessiontoken", "password", "accesstoken", "refreshtoken", "privatekey", "jwt"].contains(normalized) { continue }
                guard let nested = properties[key] ?? (rule["additionalProperties"] as? [String: Any]) else { continue }
                guard key.count <= 100, !key.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw WorkspaceError.invalidDocument }
                // Official full token counters can explicitly omit the optional countdown.
                if key == "nextTokenInSeconds", entry is NSNull { continue }
                output[key] = try projectValue(entry, rule: nested, definitions: definitions, depth: depth + 1)
            }
            return output
        case "array":
            guard let value = value as? [Any], value.count <= 10_000, let items = rule["items"] as? [String: Any] else { throw WorkspaceError.invalidDocument }
            return try value.map { try projectValue($0, rule: items, definitions: definitions, depth: depth + 1) }
        case "string":
            guard let value = value as? String, value.count <= 1000,
                  !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  (rule["enum"] as? [String]).map({ $0.contains(value) }) ?? true else { throw WorkspaceError.invalidDocument }
            return value
        case "integer", "number":
            guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite,
                  abs(value.doubleValue) <= 9_007_199_254_740_991,
                  rule["type"] as? String != "integer" || value.doubleValue.rounded() == value.doubleValue,
                  (rule["minimum"] as? NSNumber).map({ value.doubleValue >= $0.doubleValue }) ?? true,
                  (rule["maximum"] as? NSNumber).map({ value.doubleValue <= $0.doubleValue }) ?? true else { throw WorkspaceError.invalidDocument }
            return value
        case "boolean":
            guard let value = value as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw WorkspaceError.invalidDocument }
            return value
        default: throw WorkspaceError.invalidDocument
        }
    }
    func portablePlayer() throws -> PlayerSnapshot {
        guard let details = player["details"] as? [String: Any], let name = details["name"] as? String,
              let units = player["units"] as? [[String: Any]], units.count <= 1000,
              let updated = object["updatedOn"] as? NSNumber else { throw WorkspaceError.invalidDocument }
        let roster: [[String: Any]] = units.map { unit in
            ["id": unit["id"] ?? NSNull(), "name": unit["name"] ?? unit["id"] ?? NSNull(),
             "rank": unit["rank"] ?? NSNull(), "xpLevel": unit["xpLevel"] ?? NSNull()]
        }
        let raid = (player["progress"] as? [String: Any])?["guildRaid"] as? [String: Any]
        let portable: [String: Any] = ["displayName": String(name.prefix(100)), "units": roster,
            "resources": ["guildRaidTokens": raid?["tokens"] ?? NSNull(), "bombTokens": raid?["bombTokens"] ?? NSNull()],
            "upstreamUpdatedAt": updated.int64Value * 1000]
        let data = try JSONSerialization.data(withJSONObject: ["schemaVersion": "mobile-workspace/v1", "mode": "personal", "player": portable, "raids": []])
        guard let result = try WorkspaceDocument.decode(data).player else { throw WorkspaceError.invalidDocument }; return result
    }
}

struct LocalBackup {
    static let limit = 6 * 1024 * 1024
    let document: WorkspaceDocument
    let playerCache: PlayerCache?
    func encoded() throws -> Data {
        if let playerCache, try playerCache.portablePlayer() != document.player { throw WorkspaceError.invalidDocument }
        let value: [String: Any] = ["schemaVersion": "ios-local-backup/v1",
            "workspace": try JSONSerialization.jsonObject(with: document.encoded()),
            "playerCache": playerCache.map { $0.object as Any } ?? NSNull()]
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        guard data.count <= Self.limit else { throw WorkspaceError.invalidDocument }; return data
    }
    static func decode(_ data: Data) throws -> LocalBackup {
        guard data.count <= limit, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(value.keys) == ["schemaVersion", "workspace", "playerCache"],
              value["schemaVersion"] as? String == "ios-local-backup/v1", let workspace = value["workspace"] else { throw WorkspaceError.invalidDocument }
        let document = try WorkspaceDocument.decode(JSONSerialization.data(withJSONObject: workspace))
        let cache: PlayerCache?
        if value["playerCache"] is NSNull { cache = nil }
        else if let object = value["playerCache"] as? [String: Any] { cache = try PlayerCache.decode(JSONSerialization.data(withJSONObject: object)) }
        else { throw WorkspaceError.invalidDocument }
        if let cache, try cache.portablePlayer() != document.player { throw WorkspaceError.invalidDocument }
        return LocalBackup(document: document, playerCache: cache)
    }
}
