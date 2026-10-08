import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_GUILD_HERALD_CONFIG } from '@/app/lib/herald/config'
import type { DefeatTransition } from '@/app/lib/herald/contracts'
import { createEmptyHeraldRunResult } from '@/app/lib/herald/run-types'

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
const collapse = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/logging', () => ({ createComponentLogger: () => log }))
vi.mock('@/app/lib/herald/detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/herald/detect')>()),
  collapseCombinedPrimeDefeats: collapse
}))

import { dispatchDefeatPhase } from '@/app/lib/herald/run-phases/defeat'

const secondary: DefeatTransition = {
  boss_id: 'PrimeB_E1',
  boss_type: 'PrimeB',
  boss_display_name: 'Prime B',
  rarity: 'Legendary',
  tier: 4,
  set: 1,
  completed_on: 1_700_000_000_000,
  killer_display_name: null,
  killer_user_id: null,
  season: 90,
  loop_index: 0
}

function clientReturning(error: { code: string; message: string } | null) {
  const insert = vi.fn().mockResolvedValue({ data: null, error })
  return {
    insert,
    supabase: { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
  }
}

async function runWith(supabase: SupabaseClient) {
  await dispatchDefeatPhase({
    supabase,
    guildCode: 'GUILD',
    invocationId: 'inv',
    defeatTransitions: [],
    availabilityTransitions: [],
    bossDisplayOverrides: new Map(),
    bossConfigs: { resolve: () => null, size: 0, rows: [] },
    pingModesPerSeason: new Map(),
    guildHeraldConfig: { ...DEFAULT_GUILD_HERALD_CONFIG },
    guildDefaultUrl: null,
    guildDefaultThreadId: null,
    result: createEmptyHeraldRunResult('defeat')
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  collapse.mockReturnValue({ dispatched: [], consumed: [secondary] })
})

describe('defeat phase pre-claim of combined secondaries', () => {
  it('reports a claim the database refused', async () => {
    const { supabase, insert } = clientReturning({
      code: '42501',
      message: 'permission denied for table herald_posted_events'
    })

    await runWith(supabase)

    expect(insert).toHaveBeenCalledOnce()
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        boss_id: 'PrimeB_E1',
        error: 'permission denied for table herald_posted_events'
      }),
      'herald.combine.dedup_claim_error'
    )
  })

  it('treats an existing claim as already done', async () => {
    const { supabase } = clientReturning({
      code: '23505',
      message: 'duplicate key value violates unique constraint'
    })

    await runWith(supabase)

    expect(log.warn).not.toHaveBeenCalled()
  })
})
