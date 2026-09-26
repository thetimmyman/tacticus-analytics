/** Toggles use the atomic RPC so a partial failure never leaves zero active rows. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
  neq: vi.fn(),
  state: {
    list: [] as Array<Record<string, unknown>>,
    listError: null as { message: string } | null,
    target: { scope: 'TEST' } as { scope: string } | null,
    targetError: null as { message: string } | null
  }
}))

vi.mock('@/app/lib/auth/app-admin', () => ({
  requireAppAdminForApi: vi.fn(async () => ({}))
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: vi.fn(() => ({
    rpc: mocks.rpc,
    from: vi.fn(() => ({
      update: mocks.update,
      select: vi.fn((columns: string) => {
        if (columns === '*') {
          return {
            neq: mocks.neq.mockImplementation(
              (field: string, excludedValue: string) => ({
                order: vi.fn(() => ({
                  order: vi.fn(async () => ({
                    data: mocks.state.list.filter(
                      (row) => row[field] !== excludedValue
                    ),
                    error: mocks.state.listError
                  }))
                }))
              })
            )
          }
        }
        return {
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: mocks.state.target,
              error: mocks.state.targetError
            }))
          }))
        }
      })
    }))
  }))
}))

import { GET, PUT } from '@/app/api/admin/progression-config/route'

const ID = '00000000-0000-4000-8000-000000000001'

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/progression-config', {
    method: 'PUT',
    body: JSON.stringify(body)
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ error: null })
  mocks.state.list = []
  mocks.state.listError = null
  mocks.state.target = { scope: 'TEST' }
  mocks.state.targetError = null
})

describe('GET /api/admin/progression-config', () => {
  it('excludes retired global rows while returning guild overrides', async () => {
    mocks.state.list = [
      { id: 'global-id', scope: 'global', is_active: true },
      { id: 'guild-id', scope: 'TEST', is_active: true }
    ]

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      configs: [{ id: 'guild-id', scope: 'TEST', is_active: true }]
    })
    expect(mocks.neq).toHaveBeenCalledWith('scope', 'global')
  })
})

describe('PUT /api/admin/progression-config', () => {
  it('activates a guild override through the atomic RPC', async () => {
    const response = await PUT(makeRequest({ id: ID, is_active: true }))

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('set_active_progression_config', {
      p_id: ID,
      p_is_active: true
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('deactivates a guild override through the same RPC', async () => {
    const response = await PUT(makeRequest({ id: ID, is_active: false }))

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('set_active_progression_config', {
      p_id: ID,
      p_is_active: false
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects a legacy global target because runtime ignores it', async () => {
    mocks.state.target = { scope: 'global' }

    const response = await PUT(makeRequest({ id: ID, is_active: true }))

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining(
          'Global progression controls are retired'
        )
      }
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('surfaces an RPC failure instead of reporting success', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'boom' } })

    const response = await PUT(makeRequest({ id: ID, is_active: true }))

    expect(response.status).toBeGreaterThanOrEqual(400)
    await expect(response.json()).resolves.not.toMatchObject({ success: true })
  })

  it('rejects a malformed body before touching the database', async () => {
    const response = await PUT(makeRequest({ id: ID }))

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
