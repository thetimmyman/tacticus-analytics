import { describe, it, expect } from 'vitest'
import {
  normalizeAppRole,
  processTimestamp,
  processSetValue,
  formatUnitDisplayName,
  truncateIsoToWholeSecond,
  validateDataTypes,
  processRaidEntry,
  handleDuplicateDisplayNames,
  detectSeason,
  extractEntries,
  filterValidEntries,
  filterProcessedData,
  sanitizeRaidEntries,
  type LokiMember,
  type RawRaidEntry,
  type BossMappings,
  type GuildRaidApiResponse
} from '@/app/lib/sync/transformers'

describe('normalizeAppRole', () => {
  it('returns "member" for null/undefined', () => {
    expect(normalizeAppRole(null)).toBe('member')
    expect(normalizeAppRole(undefined)).toBe('member')
  })

  it('normalizes valid roles case-insensitively (returns first match from APP_ROLES)', () => {
    expect(normalizeAppRole('leader')).toBe('leader')
    expect(normalizeAppRole('LEADER')).toBe('leader')
    expect(normalizeAppRole('Leader')).toBe('leader')
    expect(normalizeAppRole('officer')).toBe('officer')
    expect(normalizeAppRole('OFFICER')).toBe('officer')
    expect(normalizeAppRole('member')).toBe('member')
    expect(normalizeAppRole('MEMBER')).toBe('member')
    expect(normalizeAppRole('demo')).toBe('demo')
  })

  it('returns "member" for unknown roles', () => {
    expect(normalizeAppRole('admin')).toBe('member')
    expect(normalizeAppRole('superuser')).toBe('member')
    expect(normalizeAppRole('')).toBe('member')
  })
})

describe('processTimestamp', () => {
  it('returns current ISO string for null/undefined', () => {
    const before = Date.now()
    const result = processTimestamp(null)
    const after = Date.now()
    const resultTime = new Date(result).getTime()
    expect(resultTime).toBeGreaterThanOrEqual(before)
    expect(resultTime).toBeLessThanOrEqual(after)
  })

  it('handles Date objects', () => {
    const date = new Date('2024-01-15T12:00:00Z')
    expect(processTimestamp(date)).toBe('2024-01-15T12:00:00.000Z')
  })

  it('handles Unix timestamps in seconds', () => {
    const result = processTimestamp(1704067200)
    expect(result).toBe('2024-01-01T00:00:00.000Z')
  })

  it('handles Unix timestamps in milliseconds', () => {
    const result = processTimestamp(1704067200000)
    expect(result).toBe('2024-01-01T00:00:00.000Z')
  })

  it('handles ISO string timestamps', () => {
    expect(processTimestamp('2024-06-15T10:30:00Z')).toBe(
      '2024-06-15T10:30:00.000Z'
    )
  })

  it('handles numeric strings', () => {
    expect(processTimestamp('1704067200')).toBe('2024-01-01T00:00:00.000Z')
    expect(processTimestamp('1704067200000')).toBe('2024-01-01T00:00:00.000Z')
  })
})

describe('truncateIsoToWholeSecond', () => {
  // Both writer paths truncate to whole seconds, or the unique index misses drift duplicates.
  it('returns null for null/undefined/empty', () => {
    expect(truncateIsoToWholeSecond(null)).toBeNull()
    expect(truncateIsoToWholeSecond(undefined)).toBeNull()
    expect(truncateIsoToWholeSecond('')).toBeNull()
  })

  it('passes whole-second ISO through unchanged', () => {
    expect(truncateIsoToWholeSecond('2026-05-06T10:18:07.000Z')).toBe(
      '2026-05-06T10:18:07.000Z'
    )
  })

  it('truncates millisecond precision to .000Z', () => {
    expect(truncateIsoToWholeSecond('2026-05-06T10:18:07.827Z')).toBe(
      '2026-05-06T10:18:07.000Z'
    )
    expect(truncateIsoToWholeSecond('2026-05-10T08:33:45.993Z')).toBe(
      '2026-05-10T08:33:45.000Z'
    )
  })

  it('truncates ISO without ms fragment to .000Z', () => {
    expect(truncateIsoToWholeSecond('2026-05-06T10:18:07Z')).toBe(
      '2026-05-06T10:18:07Z'
    )
  })
})

describe('processSetValue', () => {
  it('returns 0 for null/undefined', () => {
    expect(processSetValue(null)).toBe(0)
    expect(processSetValue(undefined)).toBe(0)
  })

  it('clamps values to 0-4 range', () => {
    expect(processSetValue(-1)).toBe(0)
    expect(processSetValue(0)).toBe(0)
    expect(processSetValue(2)).toBe(2)
    expect(processSetValue(4)).toBe(4)
    expect(processSetValue(5)).toBe(4)
    expect(processSetValue(100)).toBe(4)
  })

  it('handles string values', () => {
    expect(processSetValue('2')).toBe(2)
    expect(processSetValue('0')).toBe(0)
    expect(processSetValue('invalid')).toBe(0)
  })
})

describe('formatUnitDisplayName', () => {
  it('converts camelCase to Title Case with spaces', () => {
    expect(formatUnitDisplayName('ultramarineIntercessor')).toBe(
      'Ultramarine Intercessor'
    )
    expect(formatUnitDisplayName('khorneBerzerker')).toBe('Khorne Berzerker')
  })

  it('capitalizes first letter', () => {
    expect(formatUnitDisplayName('marine')).toBe('Marine')
  })

  it('handles already formatted names', () => {
    expect(formatUnitDisplayName('Space Marine')).toBe('Space Marine')
  })
})

describe('validateDataTypes', () => {
  it('returns true for valid entries', () => {
    expect(validateDataTypes({ Guild: 'TEST', Season: '100' }, 'TEST')).toBe(
      true
    )
  })

  it('returns false for missing Guild', () => {
    expect(validateDataTypes({ Season: '100' }, 'TEST')).toBe(false)
    expect(validateDataTypes({ Guild: null, Season: '100' }, 'TEST')).toBe(
      false
    )
  })

  it('returns false for missing Season', () => {
    expect(validateDataTypes({ Guild: 'TEST' }, 'TEST')).toBe(false)
    expect(validateDataTypes({ Guild: 'TEST', Season: null }, 'TEST')).toBe(
      false
    )
  })
})

describe('handleDuplicateDisplayNames', () => {
  it('returns members unchanged when no duplicates', () => {
    const members: LokiMember[] = [
      { userId: 'id1', displayName: 'Player1', role: 'member' },
      { userId: 'id2', displayName: 'Player2', role: 'member' }
    ]
    const result = handleDuplicateDisplayNames(members, 'TEST')
    expect(result).toHaveLength(2)
    expect(result[0].displayName).toBe('Player1')
    expect(result[1].displayName).toBe('Player2')
  })

  it('appends suffix to duplicate display names', () => {
    const members: LokiMember[] = [
      { userId: 'id1', displayName: 'DupeName', role: 'member' },
      { userId: 'id2', displayName: 'DupeName', role: 'member' }
    ]
    const result = handleDuplicateDisplayNames(members, 'GUILD')
    expect(result).toHaveLength(2)
    expect(result[0].displayName).toContain('DupeName')
    expect(result[0].displayName).toContain('GUILD')
    expect(result[0].hasDuplicateName).toBe(true)
    expect(result[0].originalDisplayName).toBe('DupeName')
    expect(result[1].hasDuplicateName).toBe(true)
  })

  it('groups by userId when displayName is empty (unique userIds = no duplicates)', () => {
    const members: LokiMember[] = [
      { userId: 'user123', displayName: '', role: 'member' },
      { userId: 'user456', displayName: '', role: 'member' }
    ]
    const result = handleDuplicateDisplayNames(members, 'TEST')
    expect(result).toHaveLength(2)
    expect(result[0].hasDuplicateName).toBeUndefined()
    expect(result[1].hasDuplicateName).toBeUndefined()
  })
})

describe('detectSeason', () => {
  it('extracts season from data.season', () => {
    const data: GuildRaidApiResponse = { season: '105' }
    expect(detectSeason(data, [])).toBe('105')
  })

  it('extracts season from data.body.season', () => {
    const data: GuildRaidApiResponse = { body: { season: 106 } }
    expect(detectSeason(data, [])).toBe('106')
  })

  it('extracts season from data.currentSeason', () => {
    const data: GuildRaidApiResponse = { currentSeason: 107 }
    expect(detectSeason(data, [])).toBe('107')
  })

  it('falls back to entry season', () => {
    const entries: RawRaidEntry[] = [{ season: '108', userId: 'test' }]
    expect(detectSeason({}, entries)).toBe('108')
  })

  it('returns null when no season is found — no calendar-math fabrication', () => {
    // No invented season; the caller falls back to get_latest_season.
    expect(detectSeason(null, [])).toBeNull()
    expect(detectSeason({}, [])).toBeNull()
  })

  it('ignores null/undefined string values', () => {
    const data: GuildRaidApiResponse = { season: 'null' }
    const entries: RawRaidEntry[] = [{ season: '109', userId: 'test' }]
    expect(detectSeason(data, entries)).toBe('109')
  })
})

describe('extractEntries', () => {
  it('extracts entries from data.entries', () => {
    const data: GuildRaidApiResponse = {
      entries: [{ userId: 'u1' }, { userId: 'u2' }]
    }
    expect(extractEntries(data)).toHaveLength(2)
  })

  it('extracts entries from data.body.entries', () => {
    const data: GuildRaidApiResponse = {
      body: { entries: [{ userId: 'u1' }] }
    }
    expect(extractEntries(data)).toHaveLength(1)
  })

  it('returns empty array when no entries', () => {
    expect(extractEntries({})).toEqual([])
  })
})

describe('filterValidEntries', () => {
  it('keeps entries with userId and type', () => {
    const entries: RawRaidEntry[] = [
      { userId: 'u1', type: 'Boss1' },
      { userId: 'u2', type: 'Boss2' }
    ]
    expect(filterValidEntries(entries)).toHaveLength(2)
  })

  it('keeps entries with userId and unitId', () => {
    const entries: RawRaidEntry[] = [{ userId: 'u1', unitId: 'hero1' }]
    expect(filterValidEntries(entries)).toHaveLength(1)
  })

  it('filters out entries without userId', () => {
    const entries: RawRaidEntry[] = [
      { type: 'Boss1' },
      { userId: 'u1', type: 'Boss1' }
    ]
    expect(filterValidEntries(entries)).toHaveLength(1)
  })

  it('filters out entries without type or unitId', () => {
    const entries: RawRaidEntry[] = [
      { userId: 'u1' },
      { userId: 'u2', type: 'Boss1' }
    ]
    expect(filterValidEntries(entries)).toHaveLength(1)
  })
})

describe('filterProcessedData', () => {
  it('keeps valid processed entries', () => {
    const data = [
      { Guild: 'TEST', Season: '100', Name: 'Boss1', displayName: 'Player1' }
    ]
    expect(filterProcessedData(data as any)).toHaveLength(1)
  })

  it('filters out entries with null Guild', () => {
    const data = [
      { Guild: 'null', Season: '100', Name: 'Boss1', displayName: 'Player1' }
    ]
    expect(filterProcessedData(data as any)).toHaveLength(0)
  })

  it('filters out entries with Unknown Season', () => {
    const data = [
      {
        Guild: 'TEST',
        Season: 'Unknown',
        Name: 'Boss1',
        displayName: 'Player1'
      }
    ]
    expect(filterProcessedData(data as any)).toHaveLength(0)
  })

  it('filters out entries with Unknown Name', () => {
    const data = [
      { Guild: 'TEST', Season: '100', Name: 'Unknown', displayName: 'Player1' }
    ]
    expect(filterProcessedData(data as any)).toHaveLength(0)
  })

  it('filters out entries with Unknown displayName', () => {
    const data = [
      { Guild: 'TEST', Season: '100', Name: 'Boss1', displayName: 'Unknown' }
    ]
    expect(filterProcessedData(data as any)).toHaveLength(0)
  })

  it('strict=false: passes entry with Guild="null" (Guild/Season guards skipped)', () => {
    const data = [
      { Guild: 'null', Season: '100', Name: 'Boss1', displayName: 'Player1' }
    ]
    expect(filterProcessedData(data as any, false)).toHaveLength(1)
  })

  it('strict=false: passes entry with Season="Unknown" (Guild/Season guards skipped)', () => {
    const data = [
      {
        Guild: 'TEST',
        Season: 'Unknown',
        Name: 'Boss1',
        displayName: 'Player1'
      }
    ]
    expect(filterProcessedData(data as any, false)).toHaveLength(1)
  })

  it('strict=false: still drops entries with Unknown Name or displayName', () => {
    expect(
      filterProcessedData(
        [
          {
            Guild: 'null',
            Season: 'Unknown',
            Name: 'Unknown',
            displayName: 'Player1'
          }
        ] as any,
        false
      )
    ).toHaveLength(0)
    expect(
      filterProcessedData(
        [
          {
            Guild: 'null',
            Season: 'Unknown',
            Name: 'Boss1',
            displayName: 'Unknown'
          }
        ] as any,
        false
      )
    ).toHaveLength(0)
  })

  it('drops null entries (from processRaidEntry returning null)', () => {
    const data = [
      null,
      { Guild: 'TEST', Season: '100', Name: 'Boss1', displayName: 'Player1' },
      null
    ]
    expect(filterProcessedData(data as any)).toHaveLength(1)
    expect(filterProcessedData(data as any, false)).toHaveLength(1)
  })
})

describe('processRaidEntry', () => {
  const baseMappings: BossMappings = {
    Szarekh: { 1: 'Szarekh Prime 1', 2: 'Szarekh Prime 2' }
  }
  const playerMappings = new Map([
    ['user123', 'TestPlayer'],
    ['user123'.toLowerCase(), 'TestPlayer']
  ])

  it('processes a basic raid entry', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 0,
      damageDealt: 500000,
      startedOn: '2024-01-15T10:00:00Z',
      completedOn: '2024-01-15T10:05:00Z',
      tier: 3,
      rarity: 'Epic'
    }

    const result = processRaidEntry(
      entry,
      'TESTGUILD',
      '100',
      playerMappings,
      baseMappings,
      null,
      null
    )

    expect(result.Guild).toBe('TESTGUILD')
    expect(result.Season).toBe('100')
    expect(result.displayName).toBe('TestPlayer')
    expect(result.Name).toBe('Szarekh')
    expect(result.damageDealt).toBe(500000)
    expect(result.encounterId).toBe(0)
    expect(result.cluster_code).toBeNull()
  })

  it('uses boss mapping for prime encounters', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 1,
      damageDealt: 100000
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      baseMappings,
      null,
      null
    )

    expect(result.Name).toBe('Szarekh Prime 1')
  })

  it('generates fallback name for unmapped prime', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 5
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      baseMappings,
      null,
      null
    )

    expect(result.Name).toBe('Szarekh Prime 5')
  })

  it('handles Bomb damage type', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0,
      damageType: 'Bomb'
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result.damageType).toBe('Bomb')
  })

  it('defaults to Battle damage type', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result.damageType).toBe('Battle')
  })

  it('generates Player#XXXXXX fallback when player not in mappings', () => {
    const entry: RawRaidEntry = {
      userId: 'unknownPlayer',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      new Map(),
      {},
      null,
      null
    )

    expect(result.displayName).toBe('Player#UNKNOW')
  })

  // A raw entry's name is `username`; an unmapped user must not become Player#XXXXXX.
  it('uses the raid payload username when the player has no mapping', () => {
    const entry: RawRaidEntry = {
      userId: 'newPlayer1',
      username: 'RealUpstreamName',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      new Map(),
      {},
      null,
      null
    )

    expect(result.displayName).toBe('RealUpstreamName')
  })

  it('prefers an existing player_mapping hit over the payload username', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      username: 'SomeUnrelatedUpstreamName',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result.displayName).toBe('TestPlayer')
  })

  it('never promotes an upstream Player# alias in username to a resolved name', () => {
    // Upstream's Player#XXXXXX privacy alias is never stored as a resolved name.
    const entry: RawRaidEntry = {
      userId: 'aliasPlayer1',
      username: 'Player#DEADBE',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      new Map(),
      {},
      null,
      null
    )

    expect(result.displayName).toBe('Player#ALIASP')
    expect(result.displayName).not.toBe('Player#DEADBE')
  })

  it('handles cluster code and id', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      'EOT',
      'cluster-123'
    )

    expect(result.cluster_code).toBe('EOT')
    expect(result.cluster_id).toBe('cluster-123')
  })

  it('truncates startedOn/completedOn to whole seconds for unique-index parity', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0,
      // ms precision would bypass the unique index (the edge path writes .000Z).
      startedOn: '2026-05-06T10:18:07.827Z',
      completedOn: '2026-05-06T10:18:08.993Z'
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result.startedOn).toBe('2026-05-06T10:18:07.000Z')
    expect(result.completedOn).toBe('2026-05-06T10:18:08.000Z')
  })

  it('normalizes "null" string cluster code to null', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      'null',
      'undefined'
    )

    expect(result.cluster_code).toBeNull()
    expect(result.cluster_id).toBeNull()
  })

  it('detects Mythic rarity from HP thresholds', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0,
      maxHp: 30000000,
      rarity: 'Legendary'
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result.rarity).toBe('Mythic')
  })

  it('returns null when encounterIndex is missing (no default-to-0 phantom row)', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss'
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result).toBeNull()
  })

  it('returns null when encounterIndex is non-numeric', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 'oops' as unknown as number
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result).toBeNull()
  })

  it('does NOT fall back to encounterId when encounterIndex is missing', () => {
    // The edge path has no encounterId fallback, so this drops for parity.
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterId: 3
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result).toBeNull()
  })

  it('resolves a valid numeric encounterIndex normally', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 1
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      baseMappings,
      null,
      null
    )

    expect(result).not.toBeNull()
    expect(result!.encounterIndex).toBe(1)
    expect(result!.encounterId).toBe(1)
  })

  // The dedup index is NULLS DISTINCT, so a null timestamp re-inserts every sync.
  it('never yields null startedOn/completedOn (deterministic fallback)', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result).not.toBeNull()
    expect(result!.startedOn).not.toBeNull()
    expect(result!.completedOn).not.toBeNull()
    expect(result!.startedOn).toMatch(/\.000Z$/)
    expect(result!.completedOn).toMatch(/\.000Z$/)
  })

  it('falls back to entry.timestamp for startedOn/completedOn when present', () => {
    const entry: RawRaidEntry = {
      userId: 'user123',
      type: 'Boss',
      encounterIndex: 0,
      timestamp: '2026-05-06T10:18:07.827Z'
    }

    const result = processRaidEntry(
      entry,
      'GUILD',
      '100',
      playerMappings,
      {},
      null,
      null
    )

    expect(result).not.toBeNull()
    expect(result!.startedOn).toBe('2026-05-06T10:18:07.000Z')
    expect(result!.completedOn).toBe('2026-05-06T10:18:07.000Z')
  })
})

describe('sanitizeRaidEntries', () => {
  it('drops entries with a null/missing encounterIndex', () => {
    const { sanitized, dropped } = sanitizeRaidEntries(
      [{ userId: 'user', type: 'Boss' }],
      'GUILD'
    )
    expect(sanitized).toHaveLength(0)
    expect(dropped).toBe(1)
  })

  it('drops entries with a non-numeric encounterIndex', () => {
    const { sanitized, dropped } = sanitizeRaidEntries(
      [{ userId: 'user', encounterIndex: 'oops' as unknown as number }],
      'GUILD'
    )
    expect(sanitized).toHaveLength(0)
    expect(dropped).toBe(1)
  })

  it('drops entries with an out-of-range encounterIndex', () => {
    const { sanitized, dropped } = sanitizeRaidEntries(
      [
        { userId: 'user', encounterIndex: -1 },
        { userId: 'user', encounterIndex: 1001 }
      ],
      'GUILD'
    )
    expect(sanitized).toHaveLength(0)
    expect(dropped).toBe(2)
  })

  it('drops non-object entries and missing userId', () => {
    const { sanitized, dropped } = sanitizeRaidEntries(
      [
        null as unknown as RawRaidEntry,
        { encounterIndex: 0 } as RawRaidEntry,
        { userId: '   ', encounterIndex: 0 }
      ],
      'GUILD'
    )
    expect(sanitized).toHaveLength(0)
    expect(dropped).toBe(3)
  })

  it('keeps entries with a valid in-range encounterIndex', () => {
    const { sanitized, dropped } = sanitizeRaidEntries(
      [
        { userId: 'user', encounterIndex: 0 },
        { userId: 'user', encounterIndex: 1000 }
      ],
      'GUILD'
    )
    expect(sanitized).toHaveLength(2)
    expect(dropped).toBe(0)
  })
})
