import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockDecryptApiKey: ReturnType<typeof vi.fn>
let mockFetch: ReturnType<typeof vi.fn>

describe('/api/sync/worker', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  const CRON_SECRET = 'test-cron-secret'

  beforeEach(async () => {
    vi.resetModules()

    process.env.CRON_SECRET = CRON_SECRET

    mockCreateServiceClient = vi.fn()
    mockDecryptApiKey = vi.fn()
    mockFetch = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/encryption', () => ({
      decryptApiKey: mockDecryptApiKey
    }))

    vi.stubGlobal('fetch', mockFetch)

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/sync/worker/route')
    POST = routeModule.POST
    GET = routeModule.GET
  })

  afterEach(() => {})

  describe('POST /api/sync/worker', () => {
    describe('authorization', () => {
      it('returns 500 when CRON_SECRET is not configured', async () => {
        process.env.CRON_SECRET = ''

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer anything'
          }
        })

        const response = await POST(request)

        expect(response.status).toBe(500)
      })

      it('returns 401 when authorization header is missing', async () => {
        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST'
        })

        const response = await POST(request)

        expect(response.status).toBe(401)
      })

      it('returns 401 when authorization header is invalid', async () => {
        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer wrong-secret'
          }
        })

        const response = await POST(request)

        expect(response.status).toBe(401)
      })

      it('accepts valid authorization header', async () => {
        mockSupabase.rpc
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CRON_SECRET}`
          }
        })

        const response = await POST(request)

        expect(response.status).toBe(200)
      })
    })

    describe('job processing', () => {
      it('returns success with 0 jobs when queue is empty', async () => {
        mockSupabase.rpc
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CRON_SECRET}`
          }
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.jobsProcessed).toBe(0)
      })

      it('processes claimed job and returns results', async () => {
        const mockJob = {
          id: 'job-123',
          guild_code: 'GUILD1',
          job_type: 'incremental_sync',
          payload: null
        }

        mockSupabase.rpc
          .mockResolvedValueOnce({ data: mockJob, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'guild_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  guild_code: 'GUILD1',
                  api_key_encrypted: 'encrypted-key',
                  cluster_code: 'EOT'
                },
                error: null
              })
            }
          }
          if (table === 'guild_sync_status') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { last_sync: '2026-01-01T00:00:00Z' },
                error: null
              })
            }
          }
          if (table === 'EOT_GR_data') {
            return {
              delete: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              upsert: vi.fn().mockResolvedValue({ error: null })
            }
          }
          if (table === 'player_mapping') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null })
            }
          }
          return { select: vi.fn().mockReturnThis() }
        })

        mockDecryptApiKey.mockResolvedValue('decrypted-api-key')

        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            entries: [],
            currentSeason: 100
          })
        })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CRON_SECRET}`
          }
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.workerId).toBeDefined()
        expect(body.duration).toBeDefined()
      })

      it('drains with three lanes by default, the last one background-first', async () => {
        delete process.env.SYNC_DRAIN_LANES
        mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

        const response = await POST(
          new NextRequest('http://localhost/api/sync/worker', {
            method: 'POST',
            headers: { Authorization: `Bearer ${CRON_SECRET}` }
          })
        )
        const body = await response.json()

        expect(body.lanes).toBe(3)
        expect(body.perLane.map((lane: { role: string }) => lane.role)).toEqual(
          ['any', 'any', 'background_first']
        )
        const claimWorkers = mockSupabase.rpc.mock.calls
          .filter(([name]) => name === 'claim_next_job')
          .map(([, args]) => (args as { p_worker_id: string }).p_worker_id)
        expect(new Set(claimWorkers).size).toBe(3)
        const recorded = mockSupabase.rpc.mock.calls.find(
          ([name]) => name === 'record_sync_drain_run'
        )
        expect((recorded?.[1] as { p_lanes: number }).p_lanes).toBe(3)
      })

      it('honours SYNC_DRAIN_LANES=1 as a single unfiltered lane', async () => {
        process.env.SYNC_DRAIN_LANES = '1'
        try {
          mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

          const response = await POST(
            new NextRequest('http://localhost/api/sync/worker', {
              method: 'POST',
              headers: { Authorization: `Bearer ${CRON_SECRET}` }
            })
          )
          const body = await response.json()

          expect(body.lanes).toBe(1)
          expect(body.perLane[0].role).toBe('any')
          const claims = mockSupabase.rpc.mock.calls.filter(
            ([name]) => name === 'claim_next_job'
          )
          expect(
            claims.every(
              ([, args]) =>
                (args as { p_job_types?: unknown }).p_job_types === undefined
            )
          ).toBe(true)
        } finally {
          delete process.env.SYNC_DRAIN_LANES
        }
      })

      it('generates unique worker ID for each request', async () => {
        mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

        const request1 = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const request2 = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response1 = await POST(request1)
        const body1 = await response1.json()

        const response2 = await POST(request2)
        const body2 = await response2.json()

        expect(body1.workerId).not.toBe(body2.workerId)
        expect(body1.workerId).toMatch(/^w-\d+-[a-z0-9]+$/)
      })

      it('calls reset_stuck_jobs after processing', async () => {
        mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        await POST(request)

        expect(mockSupabase.rpc).toHaveBeenCalledWith('reset_stuck_jobs')
      })

      it('calls cleanup_old_sync_data after processing', async () => {
        mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        await POST(request)

        expect(mockSupabase.rpc).toHaveBeenCalledWith('cleanup_old_sync_data')
      })

      it('preserves supabase rpc context during worker execution', async () => {
        const rpcWithContext = vi.fn(function (
          this: { rest?: Record<string, unknown> },
          _functionName: string,
          _params?: Record<string, unknown>
        ) {
          if (!this?.rest) {
            throw new TypeError(
              "Cannot read properties of undefined (reading 'rest')"
            )
          }
          return Promise.resolve({ data: null, error: null })
        })

        ;(mockSupabase as unknown as { rest?: Record<string, unknown> }).rest =
          {}
        mockSupabase.rpc = rpcWithContext

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(rpcWithContext).toHaveBeenCalledWith('reset_stuck_jobs')
      })
    })

    describe('job types', () => {
      const setupJobTest = (jobType: string) => {
        const mockJob = {
          id: 'job-123',
          guild_code: 'GUILD1',
          job_type: jobType,
          payload: null
        }

        mockSupabase.rpc
          .mockResolvedValueOnce({ data: mockJob, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              guild_code: 'GUILD1',
              api_key_encrypted: 'encrypted-key',
              cluster_code: 'EOT'
            },
            error: null
          }),
          delete: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        })

        mockDecryptApiKey.mockResolvedValue('decrypted-api-key')
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ entries: [], members: [] })
        })
      }

      it('handles full_sync job type', async () => {
        setupJobTest('full_sync')

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)

        expect(response.status).toBe(200)
      })

      it('handles incremental_sync job type', async () => {
        setupJobTest('incremental_sync')

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)

        expect(response.status).toBe(200)
      })

      it('handles validation_sync job type', async () => {
        const mockJob = {
          id: 'job-123',
          guild_code: 'GUILD1',
          job_type: 'validation_sync',
          payload: null
        }

        mockSupabase.rpc
          .mockResolvedValueOnce({ data: mockJob, error: null })
          .mockResolvedValueOnce({ data: [], error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { guild_code: 'GUILD1', cluster_code: 'EOT' },
            error: null
          }),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null })
        })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.results[0].success).toBe(true)
        expect(body.results[0].errors).toEqual([])
        expect(mockDecryptApiKey).not.toHaveBeenCalled()
      })
    })

    describe('error handling', () => {
      it('marks job as failed when guild config not found', async () => {
        const mockJob = {
          id: 'job-123',
          guild_code: 'NONEXISTENT',
          job_type: 'incremental_sync'
        }

        const syncQueueEq = vi.fn().mockResolvedValue({ error: null })
        const syncQueueUpdate = vi.fn().mockReturnValue({ eq: syncQueueEq })

        mockSupabase.rpc
          .mockResolvedValueOnce({ data: mockJob, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'guild_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' }
              })
            }
          }
          if (table === 'sync_queue') {
            return {
              update: syncQueueUpdate
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.results[0].success).toBe(false)
        expect(body.results[0].errors).toEqual([])
        expect(syncQueueUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ attempts: 999 })
        )
        expect(syncQueueEq).toHaveBeenCalledWith('id', 'job-123')
      })

      it('marks job as failed when API key decryption fails', async () => {
        const mockJob = {
          id: 'job-123',
          guild_code: 'GUILD1',
          job_type: 'incremental_sync'
        }

        mockSupabase.rpc
          .mockResolvedValueOnce({ data: mockJob, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { guild_code: 'GUILD1', api_key_encrypted: 'bad-key' },
            error: null
          })
        })

        mockDecryptApiKey.mockResolvedValue(null)

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)
        const body = await response.json()

        expect(body.results[0].success).toBe(false)
        expect(body.results[0].errors).toContain('No API key available')
      })

      it('marks job as failed when external API request fails', async () => {
        const mockJob = {
          id: 'job-123',
          guild_code: 'GUILD1',
          job_type: 'incremental_sync'
        }

        const syncQueueEq = vi.fn().mockResolvedValue({ error: null })
        const syncQueueUpdate = vi.fn().mockReturnValue({ eq: syncQueueEq })
        const guildConfigUpdateEq = vi.fn().mockResolvedValue({ error: null })
        const guildConfigUpdate = vi
          .fn()
          .mockReturnValue({ eq: guildConfigUpdateEq })

        mockSupabase.rpc
          .mockResolvedValueOnce({ data: mockJob, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'guild_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  guild_code: 'GUILD1',
                  api_key_encrypted: 'key',
                  cluster_code: 'EOT'
                },
                error: null
              }),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { consecutive_sync_failures: 2 },
                error: null
              }),
              update: guildConfigUpdate
            }
          }
          if (table === 'guild_sync_status') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { last_sync: '2026-01-01T00:00:00Z' },
                error: null
              })
            }
          }
          if (table === 'sync_queue') {
            return {
              update: syncQueueUpdate
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        })

        mockDecryptApiKey.mockResolvedValue('valid-key')
        mockFetch.mockResolvedValue({ ok: false, status: 403 })

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)
        const body = await response.json()

        expect(body.results[0].success).toBe(false)
        expect(body.results[0].errors[0]).toContain('API request failed: 403')
        expect(syncQueueUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ attempts: 999 })
        )
        expect(syncQueueEq).toHaveBeenCalledWith('id', 'job-123')
        expect(guildConfigUpdate).toHaveBeenCalledWith({
          api_key_is_valid: false,
          consecutive_sync_failures: 3
        })
        expect(guildConfigUpdateEq).toHaveBeenCalledWith('guild_code', 'GUILD1')
      })

      it('does NOT invalidate the key on a FIRST 403 — only the third strike knocks it out', async () => {
        const mockJob = {
          id: 'job-124',
          guild_code: 'GUILD1',
          job_type: 'incremental_sync'
        }

        const syncQueueEq = vi.fn().mockResolvedValue({ error: null })
        const syncQueueUpdate = vi.fn().mockReturnValue({ eq: syncQueueEq })
        const guildConfigUpdateEq = vi.fn().mockResolvedValue({ error: null })
        const guildConfigUpdate = vi
          .fn()
          .mockReturnValue({ eq: guildConfigUpdateEq })

        mockSupabase.rpc
          .mockResolvedValueOnce({ data: mockJob, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: null })

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'guild_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  guild_code: 'GUILD1',
                  api_key_encrypted: 'key',
                  cluster_code: 'EOT'
                },
                error: null
              }),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { consecutive_sync_failures: 0 },
                error: null
              }),
              update: guildConfigUpdate
            }
          }
          if (table === 'guild_sync_status') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { last_sync: '2026-01-01T00:00:00Z' },
                error: null
              })
            }
          }
          if (table === 'sync_queue') {
            return { update: syncQueueUpdate }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        })

        mockDecryptApiKey.mockResolvedValue('valid-key')
        mockFetch.mockResolvedValue({ ok: false, status: 403 })

        const response = await POST(
          new NextRequest('http://localhost/api/sync/worker', {
            method: 'POST',
            headers: { Authorization: `Bearer ${CRON_SECRET}` }
          })
        )
        const body = await response.json()

        expect(body.results[0].success).toBe(false)
        // A transient upstream 403 records a strike but must not retire a good key.
        expect(guildConfigUpdate).toHaveBeenCalledWith({
          consecutive_sync_failures: 1
        })
        expect(guildConfigUpdate).not.toHaveBeenCalledWith(
          expect.objectContaining({ api_key_is_valid: false })
        )
        expect(guildConfigUpdateEq).toHaveBeenCalledWith('guild_code', 'GUILD1')
      })

      it('returns 500 on fatal errors', async () => {
        mockSupabase.rpc.mockRejectedValue(
          new Error('Database connection lost')
        )

        const request = new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

        const response = await POST(request)

        expect(response.status).toBe(500)
      })
    })

    describe('RaidSyncOptions behavior', () => {
      let POST_local: (request: NextRequest) => Promise<Response>
      let mockLoadPlayerMappings: ReturnType<typeof vi.fn>
      let mockFetchBoss: ReturnType<typeof vi.fn>
      let mockBombTracking: ReturnType<typeof vi.fn>
      let mockRunPostSyncHooks: ReturnType<typeof vi.fn>
      let mockCheckSeasonCoverage: ReturnType<typeof vi.fn>

      interface ChainOverrides extends Record<string, unknown> {
        selectData?: Record<string, unknown>[]
        selectError?: { message?: string } | null
        upsertData?:
          | Record<string, unknown>[]
          | null
          | (() => Record<string, unknown>[] | null)
        upsertError?: { message?: string } | null
        deleteError?: { message?: string } | null
        onDelete?: () => void
        onIn?: (column: string, values: readonly unknown[]) => void
        onSelect?: (fields?: string) => void
        onUpsert?: () => void
      }

      const makeChain = (overrides: ChainOverrides = {}) => {
        const {
          selectData = [],
          selectError = null,
          upsertData,
          upsertError = null,
          deleteError = null,
          onDelete,
          onIn,
          onSelect,
          onUpsert,
          ...methodOverrides
        } = overrides
        const obj: Record<string, unknown> = {}
        let terminal: 'delete' | 'insert' | 'select' | 'upsert' | null = null
        let requestedUpsertRows = 0
        const self = () => obj
        obj.select = vi.fn().mockImplementation((fields?: string) => {
          onSelect?.(fields)
          if (
            terminal !== 'delete' &&
            terminal !== 'insert' &&
            terminal !== 'upsert'
          ) {
            terminal = 'select'
          }
          return obj
        })
        obj.eq = vi.fn().mockImplementation(self)
        obj.gte = vi.fn().mockImplementation(self)
        // Erasure-tombstone reads call `.like()` before `.in()`.
        obj.like = vi.fn().mockImplementation(self)
        obj.in = vi
          .fn()
          .mockImplementation((column: string, values: readonly unknown[]) => {
            onIn?.(column, values)
            return obj
          })
        obj.order = vi.fn().mockImplementation(self)
        obj.limit = vi.fn().mockImplementation(self)
        obj.range = vi.fn().mockImplementation(self)
        obj.single = vi.fn().mockResolvedValue({ data: null, error: null })
        obj.upsert = vi.fn().mockImplementation((rows: unknown) => {
          terminal = 'upsert'
          requestedUpsertRows = Array.isArray(rows) ? rows.length : 0
          onUpsert?.()
          return obj
        })
        obj.delete = vi.fn().mockImplementation(() => {
          terminal = 'delete'
          onDelete?.()
          return obj
        })
        obj.update = vi.fn().mockImplementation(self)
        obj.insert = vi.fn().mockImplementation(() => {
          terminal = 'insert'
          return obj
        })
        obj.then = vi
          .fn()
          .mockImplementation((resolve: (v: Record<string, unknown>) => void) =>
            Promise.resolve().then(() => {
              if (terminal === 'upsert') {
                const acknowledged =
                  typeof upsertData === 'function'
                    ? upsertData()
                    : upsertData !== undefined
                      ? upsertData
                      : Array.from({ length: requestedUpsertRows }, (_, i) => ({
                          id: i + 1
                        }))
                resolve({ data: acknowledged, error: upsertError })
                return
              }
              if (terminal === 'delete') {
                resolve({ data: [], error: deleteError })
                return
              }
              if (terminal === 'select') {
                resolve({ data: selectData, error: selectError })
                return
              }
              resolve({ data: [], error: null })
            })
          )
        Object.assign(obj, methodOverrides)
        return obj
      }

      const makeReq = () =>
        new NextRequest('http://localhost/api/sync/worker', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CRON_SECRET}` }
        })

      const setupRpcForJob = (jobType: string) => {
        mockSupabase.rpc
          .mockResolvedValueOnce({
            data: {
              id: 'j1',
              guild_code: 'G1',
              job_type: jobType,
              payload: null
            },
            error: null
          })
          .mockResolvedValue({ data: null, error: null })
      }

      const setupFromMock = (eoTOverrides: ChainOverrides = {}) => {
        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'guild_config') {
            return makeChain({
              single: vi.fn().mockResolvedValue({
                data: {
                  guild_code: 'G1',
                  api_key_encrypted: 'enc',
                  cluster_code: null
                },
                error: null
              })
            })
          }
          if (table === 'guild_sync_status') {
            return makeChain({
              single: vi.fn().mockResolvedValue({
                data: { last_sync: '2026-01-01T00:00:00Z' },
                error: null
              })
            })
          }
          if (table === 'EOT_GR_data') return makeChain(eoTOverrides)
          return makeChain()
        })
      }

      const ENTRY = {
        userId: 'u1',
        type: 'Boss',
        encounterIndex: 0,
        damageDealt: 1000,
        completedOn: new Date().toISOString()
      }

      beforeEach(async () => {
        vi.resetModules()
        process.env.CRON_SECRET = CRON_SECRET

        mockCreateServiceClient = vi.fn()
        mockDecryptApiKey = vi.fn()
        mockFetch = vi.fn()
        mockLoadPlayerMappings = vi.fn().mockResolvedValue(new Map())
        mockFetchBoss = vi.fn().mockResolvedValue({})
        mockBombTracking = vi.fn().mockResolvedValue(undefined)
        mockRunPostSyncHooks = vi.fn().mockResolvedValue(undefined)
        mockCheckSeasonCoverage = vi.fn().mockResolvedValue(undefined)

        vi.doMock('@/app/lib/auth/server', () => ({
          createServiceClient: mockCreateServiceClient
        }))
        vi.doMock('@tacticus/app-core/encryption', () => ({
          decryptApiKey: mockDecryptApiKey
        }))
        vi.doMock('@/app/lib/sync/db-operations', () => ({
          loadExistingPlayerMappings: mockLoadPlayerMappings,
          fetchBossMappings: mockFetchBoss,
          updateBombTracking: mockBombTracking
        }))
        vi.doMock('@/app/lib/sync/post-sync-hooks', () => ({
          runPostSyncHooks: mockRunPostSyncHooks,
          checkSeasonCoverage: mockCheckSeasonCoverage
        }))
        vi.stubGlobal('fetch', mockFetch)

        mockSupabase = {
          from: vi.fn(),
          rpc: vi.fn(),
          functions: {
            invoke: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        mockCreateServiceClient.mockReturnValue(mockSupabase)
        mockDecryptApiKey.mockResolvedValue('api-key')
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi
            .fn()
            .mockResolvedValue({ entries: [ENTRY], currentSeason: 100 })
        })

        const mod = await import('@/app/api/sync/worker/route')
        POST_local = mod.POST
      })

      it('full_sync: reconcile DELETE runs after successful upsert', async () => {
        setupRpcForJob('full_sync')
        const callOrder: string[] = []
        const deleteIds: unknown[] = []
        setupFromMock({
          onDelete: () => callOrder.push('delete'),
          onIn: (column, values) => {
            if (column === 'id' && Array.isArray(values)) {
              deleteIds.push(...values)
            }
          },
          onUpsert: () => callOrder.push('upsert'),
          selectData: [{ id: 1 }, { id: 99 }],
          upsertData: [{ id: 1 }]
        })

        await POST_local(makeReq())

        expect(callOrder).toContain('delete')
        expect(callOrder).toContain('upsert')
        expect(callOrder.indexOf('delete')).toBeGreaterThan(
          callOrder.indexOf('upsert')
        )
        expect(deleteIds).toEqual([99])
      })

      it('incremental_sync: DELETE not called on EOT_GR_data (deleteBeforeUpsert: false)', async () => {
        setupRpcForJob('incremental_sync')
        const deleteMock = vi.fn()
        setupFromMock({ onDelete: deleteMock })

        await POST_local(makeReq())

        expect(deleteMock).not.toHaveBeenCalled()
      })

      it('full_sync: checkSeasonCoverage queries EOT_GR_data for Season (runCoverageCheck: true)', async () => {
        setupRpcForJob('full_sync')
        setupFromMock()

        await POST_local(makeReq())

        expect(mockCheckSeasonCoverage).toHaveBeenCalledWith(
          'G1',
          100,
          mockSupabase
        )
      })

      it('incremental_sync: checkSeasonCoverage not called (runCoverageCheck: false)', async () => {
        setupRpcForJob('incremental_sync')
        setupFromMock()

        await POST_local(makeReq())

        expect(mockCheckSeasonCoverage).not.toHaveBeenCalled()
      })

      it('realtime_sync: splits 600 entries into two acknowledged batches (batchSize=500)', async () => {
        setupRpcForJob('realtime_sync')
        const recentEntries = Array.from({ length: 600 }, (_, i) => ({
          userId: `user${i}`,
          type: 'Boss',
          encounterIndex: 0,
          damageDealt: 1000,
          completedOn: new Date().toISOString()
        }))
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi
            .fn()
            .mockResolvedValue({ entries: recentEntries, currentSeason: 100 })
        })
        let upsertCount = 0
        setupFromMock({
          onUpsert: () => {
            upsertCount++
          }
        })

        const response = await POST_local(makeReq())
        const body = await response.json()

        expect(body.results[0].success).toBe(true)
        expect(upsertCount).toBe(2)
      })

      it('incremental_sync: upsert error fails the job for retry', async () => {
        setupRpcForJob('incremental_sync')
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            entries: [{ ...ENTRY, completedOn: new Date().toISOString() }],
            currentSeason: 100
          })
        })
        setupFromMock({ upsertError: { message: 'write failed' } })

        const response = await POST_local(makeReq())
        const body = await response.json()

        expect(body.results[0].success).toBe(false)
        expect(
          body.results[0].errors.some((e: string) =>
            e.includes('Batch upsert failed')
          )
        ).toBe(true)
        expect(mockSupabase.rpc).toHaveBeenCalledWith(
          'fail_job',
          expect.any(Object)
        )
        expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
          'complete_job',
          expect.any(Object)
        )
      })

      it('full_sync: upsert error tracked in result.errors (trackErrors: true)', async () => {
        setupRpcForJob('full_sync')
        setupFromMock({ upsertError: { message: 'write failed' } })

        const response = await POST_local(makeReq())
        const body = await response.json()

        expect(body.results[0].success).toBe(false)
        expect(
          body.results[0].errors.some((e: string) =>
            e.includes('Batch upsert failed')
          )
        ).toBe(true)
      })

      it('handles realtime_sync job type', async () => {
        setupRpcForJob('realtime_sync')
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ entries: [], currentSeason: 100 })
        })
        setupFromMock()

        const response = await POST_local(makeReq())

        expect(response.status).toBe(200)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/guildRaid'),
          expect.any(Object)
        )
      })

      it('handles player_sync job type', async () => {
        setupRpcForJob('player_sync')
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            members: [{ userId: 'u1', displayName: 'Player1' }]
          })
        })
        mockSupabase.from.mockImplementation(() =>
          makeChain({
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'G1', api_key_encrypted: 'enc' },
              error: null
            })
          })
        )

        const response = await POST_local(makeReq())
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.results[0].success).toBe(true)
        expect(body.results[0].playersUpdated).toBe(1)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/guild'),
          expect.any(Object)
        )
      })
    })
  })

  describe('GET /api/sync/worker', () => {
    const authorizedGetRequest = () =>
      new NextRequest('http://localhost/api/sync/worker', {
        method: 'GET',
        headers: { Authorization: `Bearer ${CRON_SECRET}` }
      })

    it('rejects requests without cron authorization', async () => {
      const response = await GET(
        new NextRequest('http://localhost/api/sync/worker', { method: 'GET' })
      )

      expect(response.status).toBe(401)
    })

    it('reports degraded status when queue stats cannot be read', async () => {
      mockSupabase.rpc.mockReturnValue({
        data: null,
        error: { message: 'get_queue_stats exploded' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await GET(authorizedGetRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
      expect(body.errors.queue).toBe('get_queue_stats exploded')
    })

    it('returns health status and queue stats', async () => {
      mockSupabase.rpc.mockReturnValue({
        data: [
          { status: 'pending', count: 5 },
          { status: 'processing', count: 2 }
        ],
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ guild_code: 'GUILD1', health_status: 'healthy' }],
          error: null
        })
      })

      const response = await GET(authorizedGetRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('healthy')
      expect(body.timestamp).toBeDefined()
    })

    it('returns queue statistics array', async () => {
      mockSupabase.rpc.mockReturnValue({
        data: [
          { status: 'pending', count: 10 },
          { status: 'completed', count: 500 }
        ],
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await GET(authorizedGetRequest())
      const body = await response.json()

      expect(body.queue).toEqual([
        { status: 'pending', count: 10 },
        { status: 'completed', count: 500 }
      ])
    })

    it('returns health records for monitored guilds', async () => {
      mockSupabase.rpc.mockReturnValue({ data: [], error: null })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            { guild_code: 'GUILD1', data_completeness: 98.5 },
            { guild_code: 'GUILD2', data_completeness: 95.0 }
          ],
          error: null
        })
      })

      const response = await GET(authorizedGetRequest())
      const body = await response.json()

      expect(body.health).toHaveLength(2)
      expect(body.health[0].guild_code).toBe('GUILD1')
    })
  })
})
