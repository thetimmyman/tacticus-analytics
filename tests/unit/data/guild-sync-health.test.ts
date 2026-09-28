import { describe, it, expect } from 'vitest'
import {
  classifyGuildSyncState,
  SYNC_STALE_AFTER_HOURS
} from '@/app/lib/data/guild-sync-health'
import type { GuildSyncStateInput } from '@/app/lib/data/guild-sync-health'

const NOW = new Date('2030-01-10T12:00:00.000Z')

function row(
  overrides: Partial<GuildSyncStateInput> = {}
): GuildSyncStateInput {
  return {
    api_key_is_valid: true,
    auto_sync_enabled: true,
    last_successful_sync: null,
    created_at: null,
    ...overrides
  }
}

const cases: Array<{
  name: string
  input: GuildSyncStateInput
  expected: ReturnType<typeof classifyGuildSyncState>
  staleAfterHours?: number
}> = [
  {
    name: 'invalid key beats everything, even a recent sync and auto-sync on',
    input: row({
      api_key_is_valid: false,
      auto_sync_enabled: true,
      last_successful_sync: '2030-01-10T11:00:00.000Z'
    }),
    expected: 'invalid_key'
  },
  {
    name: 'invalid key plus auto-sync off still reports invalid_key',
    input: row({ api_key_is_valid: false, auto_sync_enabled: false }),
    expected: 'invalid_key'
  },
  {
    name: 'null key plus auto-sync off reports no_key',
    input: row({ api_key_is_valid: null, auto_sync_enabled: false }),
    expected: 'no_key'
  },
  {
    name: 'null key plus auto-sync on and a recent sync reports nothing',
    input: row({
      api_key_is_valid: null,
      auto_sync_enabled: true,
      last_successful_sync: '2030-01-10T11:00:00.000Z'
    }),
    expected: null
  },
  {
    name: 'null key plus auto-sync on and a 30h-old sync reports no_key',
    input: row({
      api_key_is_valid: null,
      auto_sync_enabled: true,
      last_successful_sync: '2030-01-09T06:00:00.000Z'
    }),
    expected: 'no_key'
  },
  {
    name: 'valid key plus auto-sync off reports auto_sync_off',
    input: row({ auto_sync_enabled: false }),
    expected: 'auto_sync_off'
  },
  {
    name: 'valid key plus auto-sync null reports auto_sync_off',
    input: row({ auto_sync_enabled: null }),
    expected: 'auto_sync_off'
  },
  {
    name: 'valid key plus auto-sync on plus 25h-old sync reports stale',
    input: row({ last_successful_sync: '2030-01-09T11:00:00.000Z' }),
    expected: 'stale'
  },
  {
    name: 'valid key plus auto-sync on plus 23h-old sync reports nothing',
    input: row({ last_successful_sync: '2030-01-09T13:00:00.000Z' }),
    expected: null
  },
  {
    name: 'exactly 24h is not stale',
    input: row({ last_successful_sync: '2030-01-09T12:00:00.000Z' }),
    expected: null
  },
  {
    name: '24h plus one millisecond is stale',
    input: row({ last_successful_sync: '2030-01-09T11:59:59.999Z' }),
    expected: 'stale'
  },
  {
    name: 'never synced with a 2-day-old guild reports stale',
    input: row({ created_at: '2030-01-08T12:00:00.000Z' }),
    expected: 'stale'
  },
  {
    name: 'never synced with a 1-hour-old guild reports nothing',
    input: row({ created_at: '2030-01-10T11:00:00.000Z' }),
    expected: null
  },
  {
    name: 'onboarding guild: null key, auto-sync on, never synced, 1h old reports nothing',
    input: row({
      api_key_is_valid: null,
      created_at: '2030-01-10T11:00:00.000Z'
    }),
    expected: null
  },
  {
    name: 'never synced with a guild created exactly 24h ago is not stale',
    input: row({ created_at: '2030-01-09T12:00:00.000Z' }),
    expected: null
  },
  {
    name: 'never synced with no creation date reports nothing',
    input: row({ created_at: null }),
    expected: null
  },
  {
    name: 'unparseable last sync falls back to an old creation date',
    input: row({
      last_successful_sync: 'not-a-date',
      created_at: '2030-01-08T12:00:00.000Z'
    }),
    expected: 'stale'
  },
  {
    name: 'custom staleAfterHours of 6 flags a 7h-old sync',
    input: row({ last_successful_sync: '2030-01-10T05:00:00.000Z' }),
    expected: 'stale',
    staleAfterHours: 6
  },
  {
    name: 'staleAfterHours of 0 falls back to the default window',
    input: row({ last_successful_sync: '2030-01-09T13:00:00.000Z' }),
    expected: null,
    staleAfterHours: 0
  },
  {
    name: 'NaN staleAfterHours falls back to the default window',
    input: row({ last_successful_sync: '2030-01-09T13:00:00.000Z' }),
    expected: null,
    staleAfterHours: Number.NaN
  }
]

describe('classifyGuildSyncState', () => {
  it('uses a 24h default window', () => {
    expect(SYNC_STALE_AFTER_HOURS).toBe(24)
  })

  for (const c of cases) {
    it(c.name, () => {
      expect(classifyGuildSyncState(c.input, NOW, c.staleAfterHours)).toBe(
        c.expected
      )
    })
  }
})
