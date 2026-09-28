// A targets-surface note must survive the other sub_bosses writers (hub ops save, planner RPC).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import {
  mergeSeasonConfigSubBossPatch,
  normalizeSeasonConfigNoteField,
  normalizeSeasonConfigPingMode
} from '@/app/api/season-config/_write-helpers'
import { saveEncounterNotes } from '@/app/lib/boss-ops/persist-encounter-ops'
import { persistSideSettings } from '@/app/lib/boss-ops/persistence'
import type {
  BossState,
  HeraldBossSummary
} from '@/app/lib/boss-ops/encounter-ops-types'
import { useAutoSave } from '@/app/(dashboard)/guild-management/upcoming-assignments/hooks/useAutoSave'

// Planner autosave writes via supabase.rpc; hoisted so the hook's static import resolves to it.
const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/db/client', () => ({ dbClient: () => ({ rpc: rpcMock }) }))

const GUILD = 'TESTGUILD'
const SEASON = '103'
const LEVEL = 'M1'
const NOTE = 'Focus the left pylon first, save overcharge for phase 2'

let row: {
  id: string
  sub_bosses: Record<string, unknown>
  boss_name: string
}

/** The planner RPC's merge: jsonb `||`, a shallow key merge. */
const jsonbShallowMerge = (
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown> | null
): Record<string, unknown> => ({ ...(existing ?? {}), ...(patch ?? {}) })

const buildSupabase = () => ({
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async () => ({
        data: [row],
        error: null
      }))
    }),
    update: vi
      .fn()
      .mockImplementation(
        (payload: { sub_bosses: Record<string, unknown> }) => ({
          // The zero-row guard chains `.eq(...).select('id')`; report the matched row like PostgREST.
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockImplementation(async () => {
              row.sub_bosses = payload.sub_bosses
              return { data: [{ id: row.id ?? 1 }], error: null }
            })
          })
        })
      ),
    insert: vi.fn().mockResolvedValue({ error: null })
  })
})

const applySeasonConfigWrite = async (
  path: string,
  body: Record<string, unknown>
) => {
  const input = {
    guild_code: String(body.guild_code),
    season_number: String(body.season_number),
    level: String(body.level)
  }
  const patch: Record<string, unknown> = {}
  if (path.includes('notes-mode')) {
    for (const key of ['main_notes', 'side1_notes', 'side2_notes'] as const) {
      const value = normalizeSeasonConfigNoteField(body[key])
      if (value !== undefined) patch[key] = value
    }
    const pingMode = normalizeSeasonConfigPingMode(body.ping_mode)
    if (pingMode !== undefined) patch.ping_mode = pingMode
  } else if (path.includes('skip-prime')) {
    patch[`sub${body.sub_index}_skip`] = body.skip === true
    if (body.kill_threshold_pct !== undefined) {
      patch[`sub${body.sub_index}_kill_threshold_pct`] = body.kill_threshold_pct
    }
  } else if (path.includes('kill-threshold')) {
    patch[`sub${body.sub_index}_kill_threshold_pct`] = body.kill_threshold_pct
  } else {
    throw new Error(`Unrouted season-config write in test: ${path}`)
  }
  await mergeSeasonConfigSubBossPatch({
    supabase: buildSupabase(),
    selectedBy: 'user-1',
    input,
    patch,
    endpoint: path,
    lookupFailureMessage: 'lookup failed',
    updateFailureMessage: 'update failed',
    insertFailureMessage: 'insert failed'
  })
}

let seasonConfigCalls: Array<{ path: string; body: Record<string, unknown> }>

beforeEach(() => {
  row = {
    id: 'row-1',
    sub_bosses: { sub1: 'Abraxas', sub2: 'Thaumachus', sub1_skip: false },
    boss_name: 'Magnus the Red'
  }
  seasonConfigCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/season-config/')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >
        seasonConfigCalls.push({ path: url, body })
        await applySeasonConfigWrite(url, body)
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      throw new Error(`Unexpected fetch in test: ${url}`)
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const BOSS: HeraldBossSummary = {
  group_key: 'magnus-m1',
  boss_type: 'Magnus',
  boss_name: 'Magnus the Red',
  rarity: 'Mythic',
  set: 0, // 0-BASED; raritySetForBoss adds one -> 'M1'
  main: { boss_id: 'Magnus_E0', boss_name: 'Magnus the Red', encounter_id: 0 },
  sides: [
    { boss_id: 'Magnus_E1', boss_name: 'Abraxas', encounter_id: 1 },
    { boss_id: 'Magnus_E2', boss_name: 'Thaumachus', encounter_id: 2 }
  ]
}

const saveNoteFromTargets = () =>
  saveEncounterNotes(
    {
      guildCode: GUILD,
      bossType: BOSS.boss_type,
      rarity: 'Mythic',
      set: 1, // 1-BASED here (identity.ts) -> 'M1', same row as the hub
      encounterId: 1,
      seasonNumber: SEASON,
      // Next-season edit: skips the legacy herald_boss_config echo (a different table).
      isCurrentSeason: false
    },
    NOTE
  )

const saveUnrelatedFieldFromHub = () => {
  const state: BossState = {
    group_key: BOSS.group_key,
    expanded: true,
    mainRole: '',
    mainNotes: '',
    pingMode: 'per_side',
    side1: { role: '', behaviour: 'threshold', threshold: 40, notes: '' },
    side2: { role: '', behaviour: 'kill', threshold: 60, notes: '' },
    saveStatus: 'idle',
    dirty: true,
    editVersion: 1
  }
  return persistSideSettings(BOSS, state, GUILD, SEASON, {
    side1Behaviour: 'kill', // officer moved side1 kill -> threshold(40)
    side1ThresholdHpPct: null,
    side2Behaviour: 'kill',
    side2ThresholdHpPct: null,
    mainNotes: null,
    side1Notes: null, // hydrated BEFORE the targets note landed
    side2Notes: null,
    pingMode: 'per_side'
  })
}

const autosaveFromPlanner = async () => {
  rpcMock.mockReset().mockResolvedValue({ data: {}, error: null })

  const currentState = {
    selectedBosses: { [LEVEL]: 'Magnus the Red' },
    selectedSubBosses: {
      [`${LEVEL}_Sub1`]: 'Abraxas',
      [`${LEVEL}_Sub2`]: 'Thaumachus'
    },
    skippedPrimes: { [`${LEVEL}_Sub1`]: true },
    players: [],
    playerTokenAllocations: {},
    availableLevels: [LEVEL]
  }
  const actions = {
    getLatestState: () => currentState,
    setSaving: vi.fn(),
    setSaveMessage: vi.fn(),
    setClearing: vi.fn(),
    setPlayerTokenAllocations: vi.fn(),
    setSelectedBosses: vi.fn(),
    setSelectedSubBosses: vi.fn(),
    setPlayers: vi.fn(),
    setShowClearConfirm: vi.fn()
  }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)

  const { result, unmount } = renderHook(
    () =>
      useAutoSave(
        null as never,
        actions as never,
        GUILD,
        undefined,
        () => SEASON,
        3,
        2,
        'current',
        true
      ),
    { wrapper }
  )
  await result.current.autoSave()
  await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1))
  unmount()

  const args = rpcMock.mock.calls[0]?.[1] as {
    p_bosses: Array<{ level: string; sub_bosses: Record<string, unknown> }>
  }
  const bossRow = args.p_bosses.find((b) => b.level === LEVEL)
  expect(bossRow).toBeDefined()
  return bossRow!.sub_bosses
}

describe('cross-surface notes survival (D10)', () => {
  it('a targets note survives a hub save of an unrelated field and a planner autosave', async () => {
    await saveNoteFromTargets()
    expect(row.sub_bosses.side1_notes).toBe(NOTE)
    const notesCall = seasonConfigCalls.find((c) => c.path.includes('notes'))
    expect(notesCall?.body).not.toHaveProperty('main_notes')
    expect(notesCall?.body).not.toHaveProperty('sub1_skip')

    const callsBeforeHub = seasonConfigCalls.length
    await saveUnrelatedFieldFromHub()
    expect(row.sub_bosses.side1_notes).toBe(NOTE) // survived
    expect(row.sub_bosses.sub1_kill_threshold_pct).toBe(40) // change landed
    // The hub must have OMITTED the untouched note keys, not re-sent them.
    const hubCalls = seasonConfigCalls.slice(callsBeforeHub)
    expect(hubCalls.length).toBeGreaterThan(0)
    for (const call of hubCalls) {
      expect(call.body).not.toHaveProperty('side1_notes')
      expect(call.body).not.toHaveProperty('main_notes')
    }

    // The planner payload never carries notes; only the RPC merge keeps the note.
    const plannerSubBosses = await autosaveFromPlanner()
    expect(Object.keys(plannerSubBosses).sort()).toEqual([
      'sub1',
      'sub1_skip',
      'sub2',
      'sub2_skip'
    ])
    row.sub_bosses = jsonbShallowMerge(row.sub_bosses, plannerSubBosses)

    expect(row.sub_bosses.side1_notes).toBe(NOTE)
    expect(row.sub_bosses.sub1_skip).toBe(true)
    expect(row.sub_bosses.sub1).toBe('Abraxas')
  })

  it('pins the pre-C1 planner semantics as the bug: wholesale replacement drops the note', async () => {
    // A wholesale `sub_bosses = EXCLUDED.sub_bosses` would destroy the note.
    await saveNoteFromTargets()
    const plannerSubBosses = await autosaveFromPlanner()
    const wholesale = plannerSubBosses // a wholesale-replace RPC, not a merge
    expect(wholesale).not.toHaveProperty('side1_notes')
  })
})
