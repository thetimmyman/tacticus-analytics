import { describe, it, expect } from 'vitest'

import {
  processRaidEntry,
  sanitizeRaidEntries,
  validateDataTypes,
  type ProcessedRaidEntry
} from '../../supabase/functions/_shared/sync-modules/transforms.ts'

describe('processRaidEntry validation', () => {
  const bossMappings = { BOSS: { 0: 'Boss' } }
  const playerMappings = { user: 'User Name' }

  it('drops entries without userId', () => {
    const res = processRaidEntry(
      { userId: '', type: 'BOSS', encounterIndex: 0 },
      'GUILD',
      1,
      playerMappings,
      bossMappings,
      null,
      null
    )
    expect(res).toBeNull()
  })

  it('computes loopIndex and coerces numerics', () => {
    const res = processRaidEntry(
      {
        userId: 'user',
        type: 'BOSS',
        encounterIndex: '0',
        maxHp: '100',
        remainingHp: '10',
        damageDealt: '90',
        tier: '2'
      },
      'GUILD',
      1,
      playerMappings,
      bossMappings,
      null,
      null
    )
    expect(res).not.toBeNull()
    expect(res?.maxHp).toBe(100)
    expect(res?.remainingHp).toBe(10)
    expect(res?.damageDealt).toBe(90)
    expect(res?.loopIndex).toBeGreaterThanOrEqual(0)
  })

  it('rejects invalid encounterIndex', () => {
    const res = processRaidEntry(
      { userId: 'user', type: 'BOSS', encounterIndex: 'not-a-number' },
      'GUILD',
      1,
      playerMappings,
      bossMappings,
      null,
      null
    )
    expect(res).toBeNull()
  })

  // Raw raid entries carry `username`, not `displayName`.
  it('uses the raid payload username when the player has no mapping', () => {
    const res = processRaidEntry(
      {
        userId: 'newUser',
        username: 'RealUpstreamName',
        type: 'BOSS',
        encounterIndex: 0
      },
      'GUILD',
      1,
      {},
      bossMappings,
      null,
      null
    )
    expect(res?.displayName).toBe('RealUpstreamName')
  })

  it('prefers an existing player_mapping hit over the payload username', () => {
    const res = processRaidEntry(
      {
        userId: 'user',
        username: 'SomeUnrelatedUpstreamName',
        type: 'BOSS',
        encounterIndex: 0
      },
      'GUILD',
      1,
      playerMappings,
      bossMappings,
      null,
      null
    )
    expect(res?.displayName).toBe('User Name')
  })

  it('never promotes an upstream Player# alias in username to a resolved name', () => {
    // Player#XXXXXX is an upstream privacy alias: a fallback, never stored as a real name.
    const res = processRaidEntry(
      {
        userId: 'aliasUser',
        username: 'Player#DEADBE',
        type: 'BOSS',
        encounterIndex: 0
      },
      'GUILD',
      1,
      {},
      bossMappings,
      null,
      null
    )
    expect(res?.displayName).toMatch(/^Player#[A-Z0-9]{6}$/)
    expect(res?.displayName).not.toBe('Player#DEADBE')
    expect(res?.displayName).not.toBe('aliasUser')
  })

  it('never writes a raw userId as displayName even when a mapped name is blank', () => {
    const res = processRaidEntry(
      { userId: 'weirdUser', type: 'BOSS', encounterIndex: 0 },
      'GUILD',
      1,
      { weirdUser: '' },
      bossMappings,
      null,
      null
    )
    expect(res?.displayName).not.toBe('weirdUser')
    expect(res?.displayName).toMatch(/^Player#[A-Z0-9]{6}$/)
  })
})

describe('sanitizeRaidEntries', () => {
  it('drops bad shapes and missing userId', () => {
    const { sanitized, dropped } = sanitizeRaidEntries(
      [
        null,
        {},
        { userId: '', encounterIndex: 0 },
        { userId: ' user ', encounterIndex: 1 }
      ],
      undefined,
      { correlationId: 'c' }
    )
    expect(dropped).toBe(3)
    expect(sanitized).toHaveLength(1)
    expect(sanitized[0].userId).toBe('user')
  })

  it('drops invalid encounterIndex', () => {
    const { sanitized, dropped } = sanitizeRaidEntries([
      { userId: 'user', encounterIndex: 'oops' }
    ])
    expect(dropped).toBe(1)
    expect(sanitized).toHaveLength(0)
  })
})

describe('validateDataTypes', () => {
  const base: ProcessedRaidEntry = {
    Guild: 'G',
    Season: '1',
    displayName: 'Name',
    Name: 'Boss',
    maxHp: 1,
    remainingHp: 0,
    damageDealt: 1,
    loopIndex: 0,
    tier: 0,
    set: 0,
    encounterId: 0,
    damageType: 'Battle',
    startedOn: new Date().toISOString(),
    completedOn: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    rarity: 'Common',
    userId: 'user',
    encounterIndex: 0,
    encounterType: 'type',
    type: 'BOSS',
    unitId: '',
    globalConfigHash: '',
    heroDetails: null,
    machineOfWarDetails: null,
    cluster_code: null,
    cluster_id: null
  }

  it('passes valid entries', () => {
    expect(validateDataTypes(base, 'G')).toBe(true)
  })

  it('fails non-finite numerics', () => {
    expect(
      validateDataTypes({ ...base, damageDealt: Number.POSITIVE_INFINITY }, 'G')
    ).toBe(false)
  })
})
