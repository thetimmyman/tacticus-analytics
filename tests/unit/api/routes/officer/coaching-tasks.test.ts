import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireActiveOfficerCommandAccess = vi.fn()
const serviceDb = vi.fn()
const analyzeMember = vi.fn()
const computeFollowUp = vi.fn()

const OFFICER = { user: { id: 'officer-1' }, guildCode: 'GUILD1' }

const OPEN_ROW = {
  id: 'task-1',
  guild_code: 'GUILD1',
  display_name: 'PlayerOne',
  season: '2026-s1',
  boss_type: 'carnifex',
  encounter_index: 2,
  rarity_set: null,
  classification: 'needs_support_wrong_team',
  confidence: 'high',
  ready_now_upside: 1200,
  used_team_hash: 'hash-used',
  recommended_team_hash: 'hash-recommended',
  recommended_swaps: [{ from: 'A', to: 'B' }],
  original_actual_avg: 900,
  source_battle_count: 12,
  status: 'open',
  resolution: null,
  created_by: 'officer-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  resolved_at: null
}

const VERDICT = {
  bossType: 'carnifex',
  encounterId: 2,
  rarity: null,
  classification: 'needs_support_wrong_team',
  confidence: 'high',
  readyNowUpside: 1200,
  usedTeamHash: 'hash-used',
  recommendedTeamHash: 'hash-recommended',
  swaps: [{ from: 'A', to: 'B' }],
  actualAvg: 900,
  battleCount: 12
}

interface QueryResult {
  data: unknown
  error: unknown
}

interface ChainOptions {
  result?: QueryResult
  maybeSingleResult?: QueryResult
  singleResult?: QueryResult
}

/** Chainable supabase builder; the chain itself is thenable for awaited terminals. */
function makeChain({
  result = { data: [], error: null },
  maybeSingleResult = { data: null, error: null },
  singleResult = { data: null, error: null }
}: ChainOptions = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(maybeSingleResult),
    single: vi.fn().mockResolvedValue(singleResult),
    then: vi.fn((resolve: (value: QueryResult) => void) => resolve(result))
  }
}

type Chain = ReturnType<typeof makeChain>

function makeSupabase(tables: Record<string, Chain>) {
  const supabase = { from: vi.fn((table: string) => tables[table]) }
  return { supabase, from: supabase.from }
}

describe('GET /api/officer/coaching-tasks', () => {
  let GET: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/app/api/officer/_shared/access', () => ({
      requireActiveOfficerCommandAccess
    }))
    vi.doMock('@/app/lib/db', () => ({ serviceDb }))
    vi.doMock('@/app/lib/officer-briefing/analyze-member', () => ({
      analyzeMember
    }))
    vi.doMock('@/app/lib/officer-briefing/follow-up', () => ({
      computeFollowUp
    }))
    ;({ GET } = await import('@/app/api/officer/coaching-tasks/route'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('400s before any database work when season is missing', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const { supabase } = makeSupabase({ coaching_tasks: makeChain() })
    serviceDb.mockReturnValue(supabase)

    const response = await GET(
      new NextRequest('http://localhost/api/officer/coaching-tasks')
    )

    expect(response.status).toBe(400)
    expect(serviceDb).not.toHaveBeenCalled()
  })

  it('500s when the task list query fails', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const { supabase } = makeSupabase({
      coaching_tasks: makeChain({
        result: { data: null, error: { message: 'db down' } }
      })
    })
    serviceDb.mockReturnValue(supabase)

    const response = await GET(
      new NextRequest(
        'http://localhost/api/officer/coaching-tasks?season=2026-s1'
      )
    )

    expect(response.status).toBe(500)
  })

  it('lists open tasks in the wire shape scoped to the officer guild', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const chain = makeChain({ result: { data: [OPEN_ROW], error: null } })
    const { supabase } = makeSupabase({ coaching_tasks: chain })
    serviceDb.mockReturnValue(supabase)

    const response = await GET(
      new NextRequest(
        'http://localhost/api/officer/coaching-tasks?season=2026-s1'
      )
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { tasks: unknown[] }
    expect(body.tasks).toEqual([
      {
        task: {
          id: 'task-1',
          displayName: 'PlayerOne',
          season: '2026-s1',
          bossType: 'carnifex',
          encounterIndex: 2,
          raritySet: null,
          classification: 'needs_support_wrong_team',
          confidence: 'high',
          readyNowUpside: 1200,
          recommendedSwaps: [{ from: 'A', to: 'B' }],
          sourceBattleCount: 12,
          status: 'open',
          resolution: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          resolvedAt: null
        },
        followUp: null
      }
    ])
    expect(chain.eq).toHaveBeenCalledWith('guild_code', 'GUILD1')
    expect(chain.eq).toHaveBeenCalledWith('season', '2026-s1')
  })

  it('derives a follow-up for acknowledged tasks from post-assignment battles', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const tasksChain = makeChain({
      result: { data: [{ ...OPEN_ROW, status: 'acknowledged' }], error: null }
    })
    const eotChain = makeChain({ result: { data: [], error: null } })
    const { supabase } = makeSupabase({
      coaching_tasks: tasksChain,
      EOT_GR_data: eotChain
    })
    serviceDb.mockReturnValue(supabase)
    computeFollowUp.mockReturnValue({ due: true, reason: 'no_battles' })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/officer/coaching-tasks?season=2026-s1'
      )
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      tasks: { followUp: unknown }[]
    }
    expect(body.tasks[0].followUp).toEqual({ due: true, reason: 'no_battles' })
    expect(computeFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDominantTeamHash: null,
        currentActualAvg: null,
        currentBattleCount: 0
      })
    )
  })
})

describe('POST /api/officer/coaching-tasks', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/app/api/officer/_shared/access', () => ({
      requireActiveOfficerCommandAccess
    }))
    vi.doMock('@/app/lib/db', () => ({ serviceDb }))
    vi.doMock('@/app/lib/officer-briefing/analyze-member', () => ({
      analyzeMember
    }))
    vi.doMock('@/app/lib/officer-briefing/follow-up', () => ({
      computeFollowUp
    }))
    ;({ POST } = await import('@/app/api/officer/coaching-tasks/route'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const postRequest = (body: unknown): NextRequest =>
    new NextRequest('http://localhost/api/officer/coaching-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  const VALID_BODY = {
    displayName: 'PlayerOne',
    bossType: 'carnifex',
    encounterIndex: 2,
    raritySet: null,
    season: '2026-s1'
  }

  it('400s before database work when required fields are missing', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)

    const response = await POST(
      postRequest({ displayName: 'PlayerOne', season: '2026-s1' })
    )

    expect(response.status).toBe(400)
    expect(serviceDb).not.toHaveBeenCalled()
  })

  it('returns the already-open task idempotently without re-analyzing', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const chain = makeChain({
      maybeSingleResult: { data: { id: 'task-9', status: 'open' }, error: null }
    })
    const { supabase } = makeSupabase({ coaching_tasks: chain })
    serviceDb.mockReturnValue(supabase)

    const response = await POST(postRequest(VALID_BODY))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'task-9',
      status: 'open',
      alreadyOpen: true
    })
    expect(analyzeMember).not.toHaveBeenCalled()
  })

  it('404s when analysis has no verdict for the member/boss slice', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const { supabase } = makeSupabase({ coaching_tasks: makeChain() })
    serviceDb.mockReturnValue(supabase)
    analyzeMember.mockResolvedValue({ verdicts: [] })

    const response = await POST(postRequest(VALID_BODY))

    expect(response.status).toBe(404)
  })

  it('422s when the verdict classification is not actionable', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const { supabase } = makeSupabase({ coaching_tasks: makeChain() })
    serviceDb.mockReturnValue(supabase)
    analyzeMember.mockResolvedValue({
      verdicts: [{ ...VERDICT, classification: 'meets_expectations' }]
    })

    const response = await POST(postRequest(VALID_BODY))

    expect(response.status).toBe(422)
  })

  it('creates the task from the server-derived verdict, never client input', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const chain = makeChain({
      singleResult: { data: { id: 'task-2', status: 'open' }, error: null }
    })
    const { supabase } = makeSupabase({ coaching_tasks: chain })
    serviceDb.mockReturnValue(supabase)
    analyzeMember.mockResolvedValue({ verdicts: [VERDICT] })

    const response = await POST(
      postRequest({ ...VALID_BODY, classification: 'meets_expectations' })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'task-2',
      status: 'open',
      alreadyOpen: false
    })
    expect(analyzeMember).toHaveBeenCalledWith(
      expect.objectContaining({
        guildCode: 'GUILD1',
        displayName: 'PlayerOne',
        season: '2026-s1'
      })
    )
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        guild_code: 'GUILD1',
        classification: 'needs_support_wrong_team',
        recommended_team_hash: 'hash-recommended',
        recommended_swaps: [{ from: 'A', to: 'B' }],
        created_by: 'officer-1'
      })
    )
  })
})
