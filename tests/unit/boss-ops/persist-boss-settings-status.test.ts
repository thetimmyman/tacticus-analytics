/** A mirror-only failure reports 'saved-stale' and stays dirty so the next save retries the mirror. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persistBossSettings } from '@/app/lib/boss-ops/persistence'
import type {
  BossState,
  HeraldBossSummary,
  SaveStatus,
  SideState
} from '@/app/lib/boss-ops/encounter-ops-types'

const BOSS: HeraldBossSummary = {
  group_key: 'magnus-m1',
  boss_type: 'Magnus',
  boss_name: 'Magnus the Red',
  rarity: 'Mythic',
  set: 0, // 0-BASED
  main: { boss_id: 'Magnus_E0', boss_name: 'Magnus the Red', encounter_id: 0 },
  sides: [
    { boss_id: 'Magnus_E1', boss_name: 'Abraxas', encounter_id: 1 },
    { boss_id: 'Magnus_E2', boss_name: 'Thaumachus', encounter_id: 2 }
  ]
}

const side = (patch: Partial<SideState> = {}): SideState => ({
  role: '',
  behaviour: 'kill',
  threshold: 60,
  notes: '',
  ...patch
})

/** side1 flips kill -> skip vs the baseline, so the token mirror MUST fire. */
const stateWithSkipFlip = (): BossState => ({
  group_key: BOSS.group_key,
  expanded: true,
  mainRole: '',
  mainNotes: '',
  pingMode: 'per_side',
  side1: side({ behaviour: 'skip' }),
  side2: side(),
  saveStatus: 'idle',
  dirty: true,
  editVersion: 1
})

const BASELINE = {
  side1Behaviour: 'kill' as const,
  side2Behaviour: 'kill' as const,
  mainNotes: null,
  side1Notes: null,
  side2Notes: null,
  pingMode: 'per_side' as const,
  side1TargetTokens: 5,
  side2TargetTokens: null
}

let urls: string[] = []

function installFetch(overrides: { failUrls?: string[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET') urls.push(url)
      if (overrides.failUrls?.some((u) => url.includes(u))) {
        return new Response('nope', { status: 500 })
      }
      if (url.startsWith('/api/herald/boss-config') && method === 'GET') {
        return new Response(JSON.stringify({ config: null }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
  )
}

beforeEach(() => {
  urls = []
  installFetch()
})
afterEach(() => vi.unstubAllGlobals())

async function runSave(): Promise<{
  statuses: SaveStatus[]
  resetDirty: ReturnType<typeof vi.fn>
}> {
  const statuses: SaveStatus[] = []
  const resetDirty = vi.fn()
  await persistBossSettings(
    BOSS,
    stateWithSkipFlip(),
    'TESTGUILD',
    '103',
    '103',
    (s) => statuses.push(s),
    resetDirty,
    BASELINE
  )
  return { statuses, resetDirty }
}

describe('persistBossSettings allSettled classification (review F1)', () => {
  it("reports 'saved' and resets dirty when every write lands", async () => {
    const { statuses, resetDirty } = await runSave()
    expect(statuses).toEqual(['saving', 'saved'])
    expect(resetDirty).toHaveBeenCalledTimes(1)
  })

  it("reports 'saved-stale' — NOT 'saved' — on a mirror-only failure, and does not reset dirty", async () => {
    vi.unstubAllGlobals()
    installFetch({ failUrls: ['target-tokens'] })

    const { statuses, resetDirty } = await runSave()
    // The distinct status keeps the hub's baseline and the Save button armed for a retry.
    expect(statuses).toEqual(['saving', 'saved-stale'])
    expect(resetDirty).not.toHaveBeenCalled()
    expect(urls.some((u) => u.includes('skip-prime'))).toBe(true)
    expect(urls.some((u) => u.includes('herald/boss-config'))).toBe(true)
  })

  it("reports 'error' when an AUTHORITATIVE write fails", async () => {
    vi.unstubAllGlobals()
    installFetch({ failUrls: ['skip-prime'] })

    const { statuses, resetDirty } = await runSave()
    expect(statuses).toEqual(['saving', 'error'])
    expect(resetDirty).not.toHaveBeenCalled()
  })

  it("reports 'error' when a herald write fails alongside the mirror", async () => {
    vi.unstubAllGlobals()
    installFetch({ failUrls: ['herald/boss-config', 'target-tokens'] })

    const { statuses } = await runSave()
    expect(statuses).toEqual(['saving', 'error'])
  })
})
