import { describe, expect, it } from 'vitest'
import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import { DEFAULT_GUILD_HERALD_CONFIG } from '@/app/lib/herald/config'
import { createEmptyHeraldRunResult } from '@/app/lib/herald/run-types'
import { dispatchDefeatPhase } from '@/app/lib/herald/run-phases/defeat'
import { dispatchAvailabilityPhase } from '@/app/lib/herald/run-phases/availability'
import { dispatchBombRangePhase } from '@/app/lib/herald/run-phases/bomb-range'

const supabase = {} as ServiceSupabaseClient
const bossConfigs = { resolve: () => null, size: 0, rows: [] }

describe('Herald sync phases', () => {
  it('keeps an empty defeat phase side-effect free', async () => {
    const result = createEmptyHeraldRunResult('defeat')
    await dispatchDefeatPhase({
      supabase,
      guildCode: 'GUILD',
      invocationId: 'defeat',
      defeatTransitions: [],
      availabilityTransitions: [],
      bossDisplayOverrides: new Map(),
      bossConfigs,
      pingModesPerSeason: new Map(),
      guildHeraldConfig: { ...DEFAULT_GUILD_HERALD_CONFIG },
      guildDefaultUrl: null,
      guildDefaultThreadId: null,
      result
    })
    expect(result).toEqual(createEmptyHeraldRunResult('defeat'))
  })

  it('keeps an empty availability phase side-effect free', async () => {
    const result = createEmptyHeraldRunResult('availability')
    await dispatchAvailabilityPhase({
      supabase,
      guildCode: 'GUILD',
      invocationId: 'availability',
      availabilityTransitions: [],
      bossDisplayOverrides: new Map(),
      bossConfigs,
      pingModesPerSeason: new Map(),
      guildHeraldConfig: { ...DEFAULT_GUILD_HERALD_CONFIG },
      result,
      skippedPrimesForPredict: new Map(),
      rolesResolution: { mappings: [], droppedCount: 0 },
      roleLabels: new Map(),
      guildDefaultUrl: null,
      guildDefaultThreadId: null
    })
    expect(result).toEqual(createEmptyHeraldRunResult('availability'))
  })

  it('keeps an empty bomb dispatch phase side-effect free', async () => {
    const result = createEmptyHeraldRunResult('bomb')
    await dispatchBombRangePhase({
      supabase,
      guildCode: 'GUILD',
      invocationId: 'bomb',
      bombTransitions: [],
      bombHolderMemberIds: [],
      bossDisplayOverrides: new Map(),
      guildHeraldConfig: { ...DEFAULT_GUILD_HERALD_CONFIG },
      result
    })
    expect(result).toEqual(createEmptyHeraldRunResult('bomb'))
  })
})
