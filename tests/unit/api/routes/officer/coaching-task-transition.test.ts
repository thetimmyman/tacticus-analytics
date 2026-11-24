import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireActiveOfficerCommandAccess = vi.fn()
const serviceDb = vi.fn()

const OFFICER = { user: { id: 'officer-1' }, guildCode: 'GUILD1' }
const TASK_ID = '9f1e2d3c-4b5a-4789-abcd-ef0123456789'

interface QueryResult {
  data: unknown
  error: unknown
}

function makeChain(maybeSingleResult: QueryResult) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(maybeSingleResult)
  }
}

type Chain = ReturnType<typeof makeChain>

function makeSupabase(chains: Chain[]) {
  const from = vi.fn()
  for (const chain of chains) from.mockReturnValueOnce(chain)
  return { supabase: { from }, from }
}

describe('PATCH /api/officer/coaching-tasks/[id]', () => {
  let PATCH: (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/app/api/officer/_shared/access', () => ({
      requireActiveOfficerCommandAccess
    }))
    vi.doMock('@/app/lib/db', () => ({ serviceDb }))
    ;({ PATCH } = await import('@/app/api/officer/coaching-tasks/[id]/route'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const patch = (body: unknown): Promise<Response> =>
    PATCH(
      new NextRequest(
        `http://localhost/api/officer/coaching-tasks/${TASK_ID}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      ),
      { params: Promise.resolve({ id: TASK_ID }) }
    )

  it('400s before database work on an invalid status', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)

    const response = await patch({ status: 'open' })

    expect(response.status).toBe(400)
    expect(serviceDb).not.toHaveBeenCalled()
  })

  it('400s when resolving without a valid resolution', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)

    const response = await patch({ status: 'resolved' })

    expect(response.status).toBe(400)
    expect(serviceDb).not.toHaveBeenCalled()
  })

  it('404s when the task does not exist in the officer guild', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const existingChain = makeChain({ data: null, error: null })
    const { supabase, from } = makeSupabase([existingChain])
    serviceDb.mockReturnValue(supabase)

    const response = await patch({ status: 'acknowledged' })

    expect(response.status).toBe(404)
    expect(existingChain.eq).toHaveBeenCalledWith('id', TASK_ID)
    expect(existingChain.eq).toHaveBeenCalledWith('guild_code', 'GUILD1')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('409s when the task is already closed', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const existingChain = makeChain({
      data: { id: TASK_ID, status: 'resolved' },
      error: null
    })
    const { supabase } = makeSupabase([existingChain])
    serviceDb.mockReturnValue(supabase)

    const response = await patch({ status: 'acknowledged' })

    expect(response.status).toBe(409)
  })

  it('409s when a concurrent request closed the task first', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const existingChain = makeChain({
      data: { id: TASK_ID, status: 'open' },
      error: null
    })
    const updateChain = makeChain({ data: null, error: null })
    const { supabase } = makeSupabase([existingChain, updateChain])
    serviceDb.mockReturnValue(supabase)

    const response = await patch({ status: 'acknowledged' })

    expect(response.status).toBe(409)
    expect(updateChain.in).toHaveBeenCalledWith('status', [
      'open',
      'acknowledged'
    ])
  })

  it('acknowledges an open task without a resolution', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const existingChain = makeChain({
      data: { id: TASK_ID, status: 'open' },
      error: null
    })
    const updateChain = makeChain({
      data: { id: TASK_ID },
      error: null
    })
    const { supabase } = makeSupabase([existingChain, updateChain])
    serviceDb.mockReturnValue(supabase)

    const response = await patch({ status: 'acknowledged' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'acknowledged',
        resolution: null,
        resolved_at: null
      })
    )
  })

  it('stores the resolution and timestamp when resolving', async () => {
    requireActiveOfficerCommandAccess.mockResolvedValue(OFFICER)
    const existingChain = makeChain({
      data: { id: TASK_ID, status: 'acknowledged' },
      error: null
    })
    const updateChain = makeChain({
      data: { id: TASK_ID },
      error: null
    })
    const { supabase } = makeSupabase([existingChain, updateChain])
    serviceDb.mockReturnValue(supabase)

    const response = await patch({
      status: 'resolved',
      resolution: 'swapped_improved'
    })

    expect(response.status).toBe(200)
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolution: 'swapped_improved'
      })
    )
  })
})
