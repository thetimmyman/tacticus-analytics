import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// "Add Guild" must not write guild_config from the browser; the service route stamps authority columns.

const { dbClientMock, toastMock } = vi.hoisted(() => ({
  dbClientMock: vi.fn(),
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: dbClientMock
}))

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({ toast: toastMock })
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

vi.mock(
  '@/app/(dashboard)/leaderboards/components/cluster-management/hooks/useClusterData',
  () => ({
    extractErrorMessage: (error: Error | string): string =>
      error instanceof Error ? error.message : String(error)
  })
)

import { useGuildActions } from '@/app/(dashboard)/leaderboards/components/cluster-management/hooks/useGuildActions'

describe('useGuildActions.handleAddGuild — no browser guild_config write (WI-3136)', () => {
  let supabaseFrom: ReturnType<typeof vi.fn>
  let guildConfigUpdate: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>

  const CLUSTER_ID = 'cluster-uuid-1'
  const CLUSTER_CODE = 'CL1'

  beforeEach(() => {
    vi.clearAllMocks()

    guildConfigUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null })
    })
    supabaseFrom = vi.fn(() => ({
      update: guildConfigUpdate,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    }))
    dbClientMock.mockReturnValue({ from: supabaseFrom })

    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup() {
    const options = {
      clusterCode: CLUSTER_CODE,
      clusterId: CLUSTER_ID,
      guilds: [],
      currentUserDisplayName: 'Leader',
      setGuilds: vi.fn(),
      fetchGuilds: vi.fn().mockResolvedValue(undefined)
    }
    const { result } = renderHook(() => useGuildActions(options))
    return { result }
  }

  it('performs NO guild_config write, forwards benign settings to the route, and toasts success once cluster_id is stamped', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/guild/create-config') {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(''),
          json: () =>
            Promise.resolve({
              success: true,
              data: { guild_code: 'NEWGLD', cluster_id: CLUSTER_ID }
            })
        })
      }
      if (url === '/api/guild/initial-sync') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: false, text: () => Promise.resolve('') })
    })

    const { result } = setup()

    act(() => {
      result.current.setNewGuild({
        guild_code: 'newgld',
        display_name: 'New Guild',
        api_key: 'valid-key',
        API_Owner: 'Owner',
        enabled: true,
        token_offender_threshold: 10,
        token_abuser_threshold: 15
      })
    })

    await act(async () => {
      await result.current.handleAddGuild()
    })

    const guildConfigCalls = supabaseFrom.mock.calls.filter(
      ([table]) => table === 'guild_config'
    )
    expect(guildConfigCalls.length).toBe(0)
    expect(guildConfigUpdate).not.toHaveBeenCalled()

    const createCall = fetchMock.mock.calls.find(
      ([url]) => url === '/api/guild/create-config'
    )
    const body = JSON.parse(createCall![1].body as string)
    expect(body.api_owner).toBe('Owner')
    expect(body.token_offender_threshold).toBe(10)
    expect(body.token_abuser_threshold).toBe(15)
    expect(body.enabled).toBe(true)
    expect(body.cluster_id).toBeUndefined()

    expect(toastMock.success).toHaveBeenCalledTimes(1)
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('shows an error (NOT a false success) when the server did not stamp cluster_id', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/guild/create-config') {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(''),
          json: () =>
            Promise.resolve({
              success: true,
              data: { guild_code: 'NEWGLD', cluster_id: null }
            })
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const { result } = setup()

    act(() => {
      result.current.setNewGuild({
        guild_code: 'newgld',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })
    })

    await act(async () => {
      await result.current.handleAddGuild()
    })

    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(guildConfigUpdate).not.toHaveBeenCalled()
  })
})
