import { describe, it, expect } from 'vitest'

type PlayerNameMap = Map<string, string>

type PlayerMappingRow = {
  player_id?: string | null
  display_name?: string | null
}

type SupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: boolean
      ) => Promise<{ data: PlayerMappingRow[] | null }>
    }
  }
}

const isUidLikeName = (name: string): boolean => {
  if (!name) return true
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const playerHashPattern = /^Player#[A-F0-9]{6}$/i
  return uuidPattern.test(name) || playerHashPattern.test(name)
}

const resolveDisplayName = (
  displayName: string | null | undefined,
  userId: string | null | undefined,
  playerNameMap: PlayerNameMap
): string => {
  if (!displayName) {
    if (userId && playerNameMap.has(userId)) {
      return playerNameMap.get(userId)!
    }
    if (userId && playerNameMap.has(userId.toLowerCase())) {
      return playerNameMap.get(userId.toLowerCase())!
    }
    const shortId =
      userId?.replace(/-/g, '').substring(0, 6).toUpperCase() || 'UNKNWN'
    return `Player#${shortId}`
  }
  if (!isUidLikeName(displayName)) {
    return displayName
  }
  if (userId && playerNameMap.has(userId)) {
    return playerNameMap.get(userId)!
  }
  if (userId && playerNameMap.has(userId.toLowerCase())) {
    return playerNameMap.get(userId.toLowerCase())!
  }
  if (displayName.startsWith('Player#')) {
    return displayName
  }
  const shortId =
    userId?.replace(/-/g, '').substring(0, 6).toUpperCase() || 'UNKNWN'
  return `Player#${shortId}`
}

async function loadPlayerNameMap(
  supabase: SupabaseClient
): Promise<PlayerNameMap> {
  const { data: playerMappings } = await supabase
    .from('player_mapping')
    .select('player_id, display_name')
    .eq('is_current', true)

  const playerNameMap = new Map<string, string>()
  for (const player of playerMappings || []) {
    if (player.player_id && player.display_name) {
      playerNameMap.set(player.player_id, player.display_name)
      playerNameMap.set(player.player_id.toLowerCase(), player.display_name)
    }
  }
  return playerNameMap
}

function createSupabaseMock(data: PlayerMappingRow[] | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data })
      })
    })
  }
}

describe('Edge Function: player-name-resolution helpers', () => {
  describe('isUidLikeName', () => {
    it('treats empty string as uid-like', () => {
      expect(isUidLikeName('')).toBe(true)
    })

    it('matches uuid values', () => {
      expect(isUidLikeName('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    })

    it('matches Player# hashes', () => {
      expect(isUidLikeName('Player#ABC123')).toBe(true)
    })

    it('rejects normal display names', () => {
      expect(isUidLikeName('Alice')).toBe(false)
    })

    it('rejects invalid Player# hashes', () => {
      expect(isUidLikeName('Player#ZZZ999')).toBe(false)
    })
  })

  describe('resolveDisplayName', () => {
    it('uses userId mapping when displayName is missing', () => {
      const map = new Map([['user-1', 'MappedName']])
      expect(resolveDisplayName(null, 'user-1', map)).toBe('MappedName')
    })

    it('uses lowercased userId mapping when displayName is missing', () => {
      const map = new Map([['user-1', 'MappedName']])
      expect(resolveDisplayName(undefined, 'USER-1', map)).toBe('MappedName')
    })

    it('builds Player# from userId when displayName is missing', () => {
      const map = new Map<string, string>()
      expect(resolveDisplayName(null, 'abc123-def456', map)).toBe(
        'Player#ABC123'
      )
    })

    it('returns Player#UNKNWN when displayName and userId are missing', () => {
      const map = new Map<string, string>()
      expect(resolveDisplayName(null, null, map)).toBe('Player#UNKNWN')
    })

    it('returns displayName when it is not uid-like', () => {
      const map = new Map([['user-1', 'MappedName']])
      expect(resolveDisplayName('Alice', 'user-1', map)).toBe('Alice')
    })

    it('uses mapping when displayName is uid-like', () => {
      const map = new Map([['user-1', 'MappedName']])
      const displayName = '123e4567-e89b-12d3-a456-426614174000'
      expect(resolveDisplayName(displayName, 'user-1', map)).toBe('MappedName')
    })

    it('uses lowercased mapping when displayName is uid-like', () => {
      const map = new Map([['user-1', 'MappedName']])
      const displayName = '123e4567-e89b-12d3-a456-426614174000'
      expect(resolveDisplayName(displayName, 'USER-1', map)).toBe('MappedName')
    })

    it('returns Player# displayName when already formatted', () => {
      const map = new Map<string, string>()
      expect(resolveDisplayName('Player#ABC123', null, map)).toBe(
        'Player#ABC123'
      )
    })

    it('builds Player# when uid-like displayName has no mapping', () => {
      const map = new Map<string, string>()
      const displayName = '123e4567-e89b-12d3-a456-426614174000'
      expect(resolveDisplayName(displayName, 'abc123-def456', map)).toBe(
        'Player#ABC123'
      )
    })

    it('uses UNKNWN when uid-like displayName has no userId', () => {
      const map = new Map<string, string>()
      const displayName = '123e4567-e89b-12d3-a456-426614174000'
      expect(resolveDisplayName(displayName, null, map)).toBe('Player#UNKNWN')
    })
  })

  describe('loadPlayerNameMap', () => {
    it('returns empty map when no data', async () => {
      const map = await loadPlayerNameMap(createSupabaseMock(null))
      expect(map.size).toBe(0)
    })

    it('maps player ids and lowercase keys', async () => {
      const data = [{ player_id: 'ABCDEF', display_name: 'Alice' }]
      const map = await loadPlayerNameMap(createSupabaseMock(data))
      expect(map.get('ABCDEF')).toBe('Alice')
      expect(map.get('abcdef')).toBe('Alice')
    })

    it('skips rows missing ids or names', async () => {
      const data = [
        { player_id: 'ABCDEF', display_name: 'Alice' },
        { player_id: null, display_name: 'Bob' },
        { player_id: 'GHIJKL', display_name: null }
      ]
      const map = await loadPlayerNameMap(createSupabaseMock(data))
      expect(map.size).toBe(2)
      expect(map.get('ABCDEF')).toBe('Alice')
      expect(map.has('GHIJKL')).toBe(false)
    })
  })
})
