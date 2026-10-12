import Foundation

extension WorkspaceStore {
    func initializeSyntheticDemo() throws {
        try transaction {
            let document = try read()
            let fresh = document == .empty
            // Imported history stays untouched, even when its Player matches the fixture.
            guard fresh || document.mode == "synthetic-demo", try playerCache() == nil else { return }
            guard let url = Bundle.main.url(forResource: "synthetic-player", withExtension: "json") else { throw WorkspaceError.invalidDocument }
            let cache = try PlayerCache.decode(Data(contentsOf: url))
            let seed = fresh ? WorkspaceDocument.demo : document
            guard try cache.portablePlayer() == seed.player else {
                if fresh { throw WorkspaceError.invalidDocument }
                return
            }
            if fresh { try write(seed) }
            try writePlayerCache(cache)
        }
    }
}
