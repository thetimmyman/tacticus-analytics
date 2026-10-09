import Foundation
import CoreFoundation

enum WorkspaceError: Error {
    case invalidDocument, unavailable, incompatibleSchema, storage, credential, scope, cancelled, noActiveRaid
}
struct TokenSnapshot: Codable, Equatable {
    var current: Int64
    var max: Int64
    var nextTokenInSeconds: Int64?
    var regenDelayInSeconds: Int64?
}
struct ResourceSnapshot: Codable, Equatable {
    var guildRaidTokens: TokenSnapshot?
    var bombTokens: TokenSnapshot?
    enum CodingKeys: String, CodingKey { case guildRaidTokens, bombTokens }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(guildRaidTokens, forKey: .guildRaidTokens)
        try container.encode(bombTokens, forKey: .bombTokens)
    }
}
struct UnitSnapshot: Codable, Equatable {
    var id: String
    var name: String
    var rank: Int64
    var xpLevel: Int64
}
struct PlayerSnapshot: Codable, Equatable {
    var displayName: String
    var units: [UnitSnapshot]
    var resources: ResourceSnapshot
    var upstreamUpdatedAt: Int64
}
struct RaidRow: Codable, Equatable {
    var player: String
    var boss: String
    var damage: Int64
    var tokens: Int64
    var observedAt: Int64
}
struct WorkspaceDocument: Codable, Equatable {
    var schemaVersion = "mobile-workspace/v1"
    var mode: String
    var player: PlayerSnapshot?
    var raids: [RaidRow]
    enum CodingKeys: String, CodingKey { case schemaVersion, mode, player, raids }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(mode, forKey: .mode)
        try container.encode(player, forKey: .player)
        try container.encode(raids, forKey: .raids)
    }
    static let empty = WorkspaceDocument(mode: "personal", player: nil, raids: [])
    static let demo = WorkspaceDocument(mode: "synthetic-demo", player: PlayerSnapshot(
        displayName: "Example Player", units: [UnitSnapshot(id: "synthetic-unit", name: "Example Unit", rank: 3, xpLevel: 10)],
        resources: ResourceSnapshot(guildRaidTokens: TokenSnapshot(current: 4, max: 6, nextTokenInSeconds: 120, regenDelayInSeconds: 3600),
                                    bombTokens: TokenSnapshot(current: 2, max: 3, nextTokenInSeconds: nil, regenDelayInSeconds: 3600)),
        upstreamUpdatedAt: 1767225600000),
        raids: [RaidRow(player: "Example Player", boss: "Example Boss", damage: 1200, tokens: 2, observedAt: 1767225600000),
                RaidRow(player: "Example Player", boss: "Example Boss", damage: 800, tokens: 1, observedAt: 1767225660000)])

    var totalDamage: Int64 { raids.reduce(0) { $0 + $1.damage } }
    var totalTokens: Int64 { raids.reduce(0) { $0 + $1.tokens } }
    var damagePerToken: Int64 { totalTokens == 0 ? 0 : totalDamage / totalTokens }
    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(self)
        _ = try Self.decode(data)
        return data
    }
    static func decode(_ data: Data) throws -> WorkspaceDocument {
        guard data.count <= 1_048_576,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw WorkspaceError.invalidDocument }
        try exact(root, ["schemaVersion", "mode", "player", "raids"])
        guard root["schemaVersion"] as? String == "mobile-workspace/v1",
              ["personal", "historical", "synthetic-demo"].contains(root["mode"] as? String ?? ""),
              let rows = root["raids"] as? [[String: Any]], rows.count <= 10_000 else { throw WorkspaceError.invalidDocument }
        if let player = root["player"] as? [String: Any] {
            try exact(player, ["displayName", "units", "resources", "upstreamUpdatedAt"])
            try text(player["displayName"])
            try integer(player["upstreamUpdatedAt"], maximum: 9_007_199_254_740_991)
            guard let units = player["units"] as? [[String: Any]], units.count <= 1000,
                  let resources = player["resources"] as? [String: Any] else { throw WorkspaceError.invalidDocument }
            for unit in units {
                try exact(unit, ["id", "name", "rank", "xpLevel"])
                try text(unit["id"]); try text(unit["name"])
                try integer(unit["rank"], maximum: 1000); try integer(unit["xpLevel"], maximum: 32767)
            }
            guard Set(resources.keys).isSubset(of: ["guildRaidTokens", "bombTokens"]) else { throw WorkspaceError.invalidDocument }
            for key in ["guildRaidTokens", "bombTokens"] {
                if let value = resources[key] as? [String: Any] {
                    guard Set(value.keys).isSubset(of: ["current", "max", "nextTokenInSeconds", "regenDelayInSeconds"]),
                          value["current"] != nil, value["max"] != nil else { throw WorkspaceError.invalidDocument }
                    for item in value.values where !(item is NSNull) { try integer(item, maximum: 1_000_000_000) }
                } else if let value = resources[key], !(value is NSNull) { throw WorkspaceError.invalidDocument }
            }
        } else if !(root["player"] is NSNull) { throw WorkspaceError.invalidDocument }
        for row in rows {
            try exact(row, ["player", "boss", "damage", "tokens", "observedAt"])
            try text(row["player"]); try text(row["boss"])
            try integer(row["damage"], maximum: 1_000_000_000_000)
            try integer(row["tokens"], minimum: 1, maximum: 100)
            try integer(row["observedAt"], maximum: 9_007_199_254_740_991)
        }
        return try JSONDecoder().decode(WorkspaceDocument.self, from: data)
    }
    private static func exact(_ object: [String: Any], _ keys: Set<String>) throws {
        guard Set(object.keys) == keys else { throw WorkspaceError.invalidDocument }
    }
    private static func text(_ value: Any?) throws {
        guard let string = value as? String, !string.isEmpty, string.count <= 100,
              !string.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw WorkspaceError.invalidDocument }
    }
    private static func integer(_ value: Any?, minimum: Int64 = 0, maximum: Int64) throws {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(minimum), number.doubleValue <= Double(maximum) else { throw WorkspaceError.invalidDocument }
    }
}

enum OfficialScope: String, CaseIterable {
    case player = "Player", guild = "Guild", raid = "Guild Raid"
    var path: String { switch self { case .player: return "player"; case .guild: return "guild"; case .raid: return "guildRaid" } }
}
enum ContributionPurpose: String, CaseIterable { case meta, portal }
enum ContributionDataset: String, CaseIterable { case raid, war, replay }
struct CapabilityState {
    var scope: OfficialScope
    var reference: String?
    var status: String
    var guild: String?
}
