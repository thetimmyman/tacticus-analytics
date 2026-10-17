import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGuildOnboardingActions } from '@/app/(dashboard)/leaderboards/components/cluster-management/hooks/useGuildOnboardingActions'

// Fixtures are synthetic; never use real guild codes, names or emails.

type Route = (init?: RequestInit) => { status: number; body: unknown }

let routes: Record<string, Route>
let calls: Array<{ path: string; body: unknown }>

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function setup() {
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
  const fetchGuilds = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() =>
    useGuildOnboardingActions({
      clusterCode: 'CLU',
      clusterId: 'cluster-1',
      fetchGuilds,
      toast
    })
  )
  return { result, toast, fetchGuilds }
}

function existing(clusterCode: string | null) {
  return () => ({
    status: 200,
    body: {
      exists: true,
      config: {
        guild_code: 'EXIST',
        display_name: 'Existing Guild',
        enabled: true,
        cluster_code: clusterCode
      }
    }
  })
}

const missing: Route = () => ({ status: 200, body: { exists: false } })

describe('useGuildOnboardingActions', () => {
  beforeEach(() => {
    calls = []
    routes = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.split('?')[0]
        calls.push({
          path,
          body: init?.body ? JSON.parse(String(init.body)) : undefined
        })
        const route = routes[path]
        if (!route) throw new Error(`unexpected fetch ${path}`)
        const { status, body } = route(init)
        return json(status, body)
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Add Guild with a code that is already registered', () => {
    it('claims a guild that is in no cluster instead of creating it', async () => {
      routes['/api/guild/check-status'] = existing(null)
      routes['/api/guild/claim'] = () => ({
        status: 200,
        body: { success: true, data: { display_name: 'Existing Guild' } }
      })
      const { result, toast, fetchGuilds } = setup()

      act(() =>
        result.current.setNewGuild({
          guild_code: 'exist',
          display_name: 'Typed Name',
          api_key: 'synthetic-key'
        })
      )
      await act(async () => {
        await result.current.handleAddGuild()
      })

      const paths = calls.map((c) => c.path)
      expect(paths).not.toContain('/api/guild/create-config')
      expect(calls.find((c) => c.path === '/api/guild/claim')?.body).toEqual(
        expect.objectContaining({
          guild_code: 'EXIST',
          api_key: 'synthetic-key',
          cluster_code: 'CLU'
        })
      )
      expect(toast.success).toHaveBeenCalled()
      expect(fetchGuilds).toHaveBeenCalled()
    })

    it('claims without a display name, since the guild already has one', async () => {
      routes['/api/guild/check-status'] = existing(null)
      routes['/api/guild/claim'] = () => ({
        status: 200,
        body: { success: true, data: { display_name: 'Existing Guild' } }
      })
      const { result, toast } = setup()

      act(() =>
        result.current.setNewGuild({
          guild_code: 'EXIST',
          api_key: 'synthetic-key'
        })
      )
      await act(async () => {
        await result.current.handleAddGuild()
      })

      expect(calls.map((c) => c.path)).toContain('/api/guild/claim')
      expect(toast.warning).not.toHaveBeenCalled()
    })

    it('shows the claim refusal when the guild belongs to another cluster', async () => {
      routes['/api/guild/check-status'] = existing('OTHER')
      routes['/api/guild/claim'] = () => ({
        status: 409,
        body: {
          error: { message: 'Guild EXIST already belongs to cluster OTHER.' }
        }
      })
      const { result, toast } = setup()

      act(() =>
        result.current.setNewGuild({
          guild_code: 'EXIST',
          api_key: 'synthetic-key'
        })
      )
      await act(async () => {
        await result.current.handleAddGuild()
      })

      expect(calls.map((c) => c.path)).not.toContain('/api/guild/create-config')
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('already belongs to cluster OTHER')
      )
    })

    it('says so and writes nothing when the guild is already in this cluster', async () => {
      routes['/api/guild/check-status'] = existing('CLU')
      const { result, toast } = setup()

      act(() =>
        result.current.setNewGuild({
          guild_code: 'EXIST',
          api_key: 'synthetic-key'
        })
      )
      await act(async () => {
        await result.current.handleAddGuild()
      })

      expect(calls.map((c) => c.path)).toEqual(['/api/guild/check-status'])
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining('already in your cluster')
      )
    })
  })

  it('still creates a guild whose code is not registered', async () => {
    routes['/api/guild/check-status'] = missing
    routes['/api/guild/create-config'] = () => ({
      status: 200,
      body: { data: { cluster_id: 'cluster-1', initialSyncTriggered: true } }
    })
    const { result, toast } = setup()

    act(() =>
      result.current.setNewGuild({
        guild_code: 'NEWG',
        display_name: 'New Guild',
        api_key: 'synthetic-key'
      })
    )
    await act(async () => {
      await result.current.handleAddGuild()
    })

    expect(calls.map((c) => c.path)).toContain('/api/guild/create-config')
    expect(calls.map((c) => c.path)).not.toContain('/api/guild/claim')
    expect(toast.success).toHaveBeenCalled()
  })

  it('retries create-config for a row whose onboarding never finished', async () => {
    routes['/api/guild/check-status'] = () => ({
      status: 200,
      body: {
        exists: true,
        config: {
          guild_code: 'NEWG',
          display_name: 'New Guild',
          enabled: true,
          cluster_code: 'CLU',
          registered: false
        }
      }
    })
    routes['/api/guild/create-config'] = () => ({
      status: 200,
      body: { data: { cluster_id: 'cluster-1', initialSyncTriggered: true } }
    })
    const { result, toast } = setup()

    act(() =>
      result.current.setNewGuild({
        guild_code: 'NEWG',
        display_name: 'New Guild',
        api_key: 'synthetic-key'
      })
    )
    await act(async () => {
      await result.current.handleAddGuild()
    })

    expect(calls.map((c) => c.path)).toEqual([
      '/api/guild/check-status',
      '/api/guild/create-config'
    ])
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
  })

  describe('Check button', () => {
    it('tells the user when no guild has that code', async () => {
      routes['/api/guild/check-status'] = missing
      const { result, toast } = setup()

      await act(async () => {
        await result.current.checkGuildExists('NEWG')
      })

      expect(result.current.claimMode).toBe(false)
      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('NEWG'))
    })

    it('reports a failed lookup instead of doing nothing', async () => {
      routes['/api/guild/check-status'] = () => ({
        status: 500,
        body: { error: 'Failed to check status' }
      })
      const { result, toast } = setup()

      await act(async () => {
        await result.current.checkGuildExists('NEWG')
      })

      expect(toast.error).toHaveBeenCalled()
    })

    it('switches to claim mode for a registered guild outside the cluster', async () => {
      routes['/api/guild/check-status'] = existing(null)
      const { result } = setup()

      await act(async () => {
        await result.current.checkGuildExists('EXIST')
      })

      expect(result.current.claimMode).toBe(true)
      expect(result.current.claimGuildInfo?.display_name).toBe('Existing Guild')
    })
  })
})
