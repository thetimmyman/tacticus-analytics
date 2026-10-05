import { describe, it, expect, vi } from 'vitest'
import {
  parseRaidFile,
  normalizeRaidFile,
  RAID_FILE_MAX_BYTES
} from '@/app/lib/desktop/raid-file'
import { processRaidEntry } from '@/app/lib/sync/transformers'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })
}))
const entry = {
  userId: 'synthetic-player-a',
  username: 'Synthetic Player A',
  type: 'SyntheticBoss',
  encounterIndex: 0,
  damageType: 'Battle',
  damageDealt: 250,
  remainingHp: 750,
  maxHp: 1000,
  tier: 5,
  set: 1,
  rarity: 'Legendary',
  startedOn: '2000-01-01T00:00:00.123Z',
  completedOn: '2000-01-01T00:00:10.987Z',
  heroDetails: [{ unitId: 'synthetic-hero', rank: 1, level: 10, power: 5700 }]
}
const file = () => ({
  format: 'ta-raid-file-v1',
  guildCode: 'SYN001',
  season: 9999,
  entries: [structuredClone(entry)]
})
const context = {
  guildCode: 'SYN001',
  playerMappings: new Map([['synthetic-player-a', 'Local Alias']]),
  bossMappings: {},
  clusterCode: null,
  clusterId: null
}
describe('local raid file boundary', () => {
  it('preserves canonical transformation, whole-second conflict keys and local name authority', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2000-01-02T00:00:00Z'))
    try {
      const rows = normalizeRaidFile(JSON.stringify(file()), context)
      expect(rows).toEqual([
        processRaidEntry(
          entry,
          'SYN001',
          '9999',
          context.playerMappings,
          {},
          null,
          null
        )
      ])
      expect(rows[0].displayName).toBe('Local Alias')
      expect(rows[0].startedOn).toBe('2000-01-01T00:00:00.000Z')
      expect(rows[0].completedOn).toBe('2000-01-01T00:00:10.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
  it('rejects the entire file if a later entry is malformed; never invents event times', () => {
    const data = file()
    data.entries.push({ ...entry, startedOn: 'invalid' })
    expect(() => parseRaidFile(JSON.stringify(data))).toThrow(
      'No data was imported'
    )
    for (const startedOn of [
      null,
      '',
      '2000-01-01',
      '1800-01-01T00:00:00Z',
      '2000-02-30T00:00:00Z'
    ]) {
      const data = file()
      Object.assign(data.entries[0], { startedOn })
      expect(() => parseRaidFile(JSON.stringify(data))).toThrow()
    }
    for (const timestamp of ['invalid', { token: 'synthetic-unused-root' }]) {
      const data = file()
      Object.assign(data.entries[0], { timestamp })
      expect(() => parseRaidFile(JSON.stringify(data))).toThrow()
    }
  })
  it('rejects unknown envelope/entry fields, credentials and unrelated guild data', () => {
    for (const data of [
      { ...file(), apiKey: 'synthetic-unused-root' },
      {
        ...file(),
        entries: [{ ...entry, access_token: 'synthetic-unused-root' }]
      }
    ]) {
      expect(() => parseRaidFile(JSON.stringify(data))).toThrow()
    }
    expect(() =>
      normalizeRaidFile(
        JSON.stringify({ ...file(), guildCode: 'SYN002' }),
        context
      )
    ).toThrow()
  })
  it('bounds file bytes, counts, numeric precision, metadata and health values', () => {
    expect(() => parseRaidFile(' '.repeat(RAID_FILE_MAX_BYTES + 1))).toThrow()
    expect(() =>
      parseRaidFile(
        JSON.stringify({ ...file(), entries: Array(10001).fill(entry) })
      )
    ).toThrow()
    for (const patch of [
      { damageDealt: -1 },
      { damageDealt: Number.MAX_SAFE_INTEGER },
      { encounterIndex: null },
      { tier: 1.5 },
      { remainingHp: 1001 },
      { completedOn: '1999-01-01T00:00:00Z' },
      { heroDetails: [{ unitId: 'synthetic', unknown: 'value' }] },
      { heroDetails: [{ unitId: 'synthetic', power: -1 }] },
      { heroDetails: [{ unitId: 'synthetic', power: Number.MAX_SAFE_INTEGER }] }
    ]) {
      const data = file()
      Object.assign(data.entries[0], patch)
      expect(() => parseRaidFile(JSON.stringify(data))).toThrow()
    }
  })
  it('retains hostile names as plain display data and does not change mapping authority', () => {
    const data = file()
    data.entries[0].userId = 'synthetic-player-b'
    data.entries[0].username = '<img src=x onerror=syntheticAttack()>'
    const rows = normalizeRaidFile(JSON.stringify(data), context)
    expect(rows[0].displayName).toBe(data.entries[0].username)
    expect(context.playerMappings.size).toBe(1)
  })
})
