import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Covered by tests/unit/compliance/erase-user-data-departed.test.ts.
vi.mock('@/app/lib/compliance/anonymize-subject-battle-rows', () => ({
  anonymizeSubjectBattleRows: vi.fn(async () => 0)
}))

let mockDb: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockRecordDataProcessing: ReturnType<typeof vi.fn>
let mockHandleDataDeletionRequest: ReturnType<typeof vi.fn>

function updateResult(rows: Array<{ guild_code: string }> = []) {
  return {
    select: vi.fn().mockResolvedValue({ data: rows, error: null }),
    then: (resolve: (value: { error: null }) => void) =>
      resolve({ error: null })
  }
}

const updateChain = (rows: Array<{ guild_code: string }> = []) => ({
  // The erasure path reads player_mapping names first, so stubs also serve select.
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: [], error: null })
  }),
  update: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue(updateResult(rows)),
    or: vi.fn().mockReturnValue(updateResult(rows))
  }),
  in: vi.fn().mockResolvedValue({ error: null })
})

describe('POST /api/account/delete', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
  }
  let mockServiceClient: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
    auth: { admin: { deleteUser: ReturnType<typeof vi.fn> } }
  }

  beforeEach(async () => {
    vi.resetModules()
    mockDb = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockApiSecurityMiddleware = vi.fn()
    mockRecordDataProcessing = vi.fn().mockResolvedValue(undefined)
    // Filed before anything is destroyed, closed after the Auth row is gone.
    mockHandleDataDeletionRequest = vi.fn().mockResolvedValue({
      request_id: '44444444-4444-4444-8444-444444444444',
      user_id: 'user123',
      request_type: 'complete',
      status: 'scheduled'
    })

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockCreateServiceClient
    }))
    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient,
      createClient: vi.fn().mockResolvedValue({})
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))
    vi.doMock('@/app/lib/compliance/gdpr-manager', () => ({
      gdprManager: {
        recordDataProcessing: mockRecordDataProcessing,
        handleDataDeletionRequest: mockHandleDataDeletionRequest
      }
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock(
      '@tacticus/app-core/logging-sanitizer',
      async (importOriginal) => ({
        ...(await importOriginal<
          typeof import('@tacticus/app-core/logging-sanitizer')
        >()),
        sanitizeErrorForLog: (e: unknown) => e
      })
    )

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    mockSupabase = {
      auth: { getUser: vi.fn() }
    }
    mockServiceClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          cleared_mapping_count: 1,
          deleted_mapping_count: 0,
          subject_authority_blocked: true,
          revoked_attestations: 1,
          purged_loki_credential_count: 0,
          purged_loki_guild_codes: [],
          binding_restorable: false
        },
        error: null
      }),
      auth: {
        admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) }
      }
    }
    mockDb.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceClient)
    mockApiSecurityMiddleware.mockResolvedValue(null)

    const routeModule = await import('@/app/api/account/delete/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const createRequest = (body: object) => {
    return new NextRequest('http://localhost/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  describe('security middleware', () => {
    it('returns rate limit response when exceeded', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
      )

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)

      expect(response.status).toBe(429)
    })
  })

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'No session' }
      })

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error.message).toBe('Not authenticated')
    })
  })

  describe('authorization', () => {
    it('returns 403 when trying to delete another user', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      const request = createRequest({
        userId: 'different-user',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('You can only delete your own a')
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
    })

    it('returns 400 when confirmation phrase is missing', async () => {
      const request = createRequest({ userId: 'user123' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Deletion confirmation phrase m')
    })

    it('returns 400 when confirmation phrase is incorrect', async () => {
      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'WRONG'
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Deletion confirmation phrase m')
    })

    it('accepts lowercase delete', async () => {
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(updateResult()),
          or: vi.fn().mockReturnValue(updateResult())
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      })

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'delete'
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
    })
  })

  describe('service client errors', () => {
    it('returns 500 when service client creation fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockCreateServiceClient.mockImplementation(() => {
        throw new Error('Service role not configured')
      })

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('Service configuration error')
    })
  })

  describe('player mapping cleanup', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
    })

    it('returns 500 when DB-owned authority and credential preparation fails', async () => {
      mockServiceClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      })
      mockServiceClient.from.mockReturnValue(updateChain())

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toContain('Failed to revoke player prof')
      expect(mockServiceClient.auth.admin.deleteUser).not.toHaveBeenCalled()
    })

    it('cleans up webhook config references', async () => {
      const mockWebhookUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockResolvedValue({ data: [{ id: 'mapping-1' }], error: null })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(updateResult()),
              or: vi.fn().mockReturnValue(updateResult())
            })
          }
        }
        if (table === 'webhook_config') {
          return { update: mockWebhookUpdate }
        }
        if (table === 'guild_themes') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(updateResult()),
              or: vi.fn().mockReturnValue(updateResult())
            })
          }
        }
        if (table === 'cluster_admins') {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        // The route purges credentials, so the fallback serves an update chain.
        return updateChain()
      })

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      await POST(request)

      expect(mockWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          updated_by: null
        })
      )
    })

    it('returns 500 when webhook cleanup fails', async () => {
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                error: { message: 'Webhook cleanup failed' }
              })
            })
          }
        }
        return updateChain()
      })

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toContain('Failed to clean up webhook ref')
    })
  })

  describe('auth user deletion', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockResolvedValue({ data: [{ id: 'mapping-1' }], error: null })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
              in: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        if (table === 'webhook_config' || table === 'guild_themes') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(updateResult()),
              or: vi.fn().mockReturnValue(updateResult())
            })
          }
        }
        if (table === 'cluster_admins') {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        return updateChain()
      })
    })

    it('deletes user successfully', async () => {
      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockServiceClient.auth.admin.deleteUser).toHaveBeenCalledWith(
        'user123'
      )
    })

    it('returns 500 without restoring revoked authority on auth deletion failure', async () => {
      mockServiceClient.auth.admin.deleteUser.mockResolvedValue({
        error: { message: 'Auth deletion failed' }
      })

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to delete user account')
      expect(mockServiceClient.rpc).toHaveBeenCalledWith(
        'prepare_player_account_deletion',
        { p_user_id: 'user123', p_reason: 'account_delete' }
      )
    })

    it('handles network errors during auth deletion', async () => {
      mockServiceClient.auth.admin.deleteUser.mockRejectedValue(
        new Error('Network error')
      )

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('Failed to delete user account')
    })

    it('supports a forward-only idempotent retry after Auth deletion fails', async () => {
      mockServiceClient.auth.admin.deleteUser
        .mockResolvedValueOnce({ error: { message: 'temporary failure' } })
        .mockResolvedValueOnce({ error: null })
      mockServiceClient.rpc
        .mockResolvedValueOnce({
          data: {
            success: true,
            cleared_mapping_count: 1,
            deleted_mapping_count: 0,
            subject_authority_blocked: true,
            revoked_attestations: 1,
            purged_loki_credential_count: 1,
            purged_loki_guild_codes: ['GUILD1'],
            binding_restorable: false
          },
          error: null
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            cleared_mapping_count: 0,
            deleted_mapping_count: 0,
            subject_authority_blocked: true,
            revoked_attestations: 0,
            purged_loki_credential_count: 0,
            purged_loki_guild_codes: [],
            binding_restorable: false
          },
          error: null
        })

      const first = await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )
      const second = await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )

      expect(first.status).toBe(500)
      expect(second.status).toBe(200)
      expect(mockServiceClient.rpc).toHaveBeenCalledTimes(2)
      expect(mockServiceClient.auth.admin.deleteUser).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('handles JSON parse errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      const request = new NextRequest('http://localhost/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json'
      })
      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('Internal server error')
    })
  })

  describe('GDPR audit trail (Article 17)', () => {
    it('records an erasure processing-log entry before deleting', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(updateResult()),
          or: vi.fn().mockReturnValue(updateResult())
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      })

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        userId: 'user123',
        confirmationPhrase: 'DELETE'
      })
      await POST(request)

      expect(mockRecordDataProcessing).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          dataType: 'account_deletion_immediate',
          processingPurpose: 'gdpr_data_erasure',
          legalBasis: 'legal_obligation'
        })
      )
    })

    /** Filed first so the gdpr-cleanup cron can finish if deleteUser fails. */
    it('files the erasure request before any destructive step', async () => {
      const order: string[] = []
      mockHandleDataDeletionRequest.mockImplementation(async () => {
        order.push('fileRequest')
        return {
          request_id: '44444444-4444-4444-8444-444444444444',
          user_id: 'user123',
          request_type: 'complete',
          status: 'scheduled'
        }
      })
      mockServiceClient.rpc.mockImplementation(async () => {
        order.push('prepare')
        return {
          data: {
            success: true,
            cleared_mapping_count: 1,
            deleted_mapping_count: 0,
            subject_authority_blocked: true,
            revoked_attestations: 1,
            purged_loki_credential_count: 0,
            purged_loki_guild_codes: [],
            binding_restorable: false
          },
          error: null
        }
      })
      mockServiceClient.auth.admin.deleteUser.mockImplementation(async () => {
        order.push('deleteUser')
        return { error: null }
      })
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockServiceClient.from.mockReturnValue(updateChain())

      const response = await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )

      expect(response.status).toBe(200)
      expect(order).toEqual(['fileRequest', 'prepare', 'deleteUser'])
      expect(mockHandleDataDeletionRequest).toHaveBeenCalledWith(
        'user123',
        'complete',
        [],
        expect.objectContaining({ scheduledFor: expect.any(String) })
      )
    })

    it('files the request and never closes it when the Auth delete fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockServiceClient.from.mockReturnValue(updateChain())
      mockServiceClient.auth.admin.deleteUser.mockResolvedValue({
        error: { message: 'foreign key constraint' }
      })

      const response = await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )

      expect(response.status).toBe(500)
      // A `scheduled` row makes the cron retry instead of abandoning the subject.
      expect(mockHandleDataDeletionRequest).toHaveBeenCalled()
    })

    it('destroys nothing when the erasure request cannot be filed', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockServiceClient.from.mockReturnValue(updateChain())
      mockHandleDataDeletionRequest.mockRejectedValue(
        new Error('Failed to process data deletion request')
      )

      const response = await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe(
        'Failed to record the account deletion request'
      )
      expect(mockServiceClient.rpc).not.toHaveBeenCalled()
      expect(mockServiceClient.auth.admin.deleteUser).not.toHaveBeenCalled()
    })
  })

  // The app must never rebuild PostgREST `.or()` filters for credential erasure.
  describe('DB-owned LOKI credential erasure', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockServiceClient.from.mockReturnValue(updateChain())
    })

    it('records the DB-owned purge count and never queries guild_config directly', async () => {
      mockServiceClient.rpc.mockResolvedValue({
        data: {
          success: true,
          cleared_mapping_count: 1,
          deleted_mapping_count: 0,
          subject_authority_blocked: true,
          revoked_attestations: 1,
          purged_loki_credential_count: 2,
          purged_loki_guild_codes: ['A', 'B'],
          binding_restorable: false
        },
        error: null
      })

      const response = await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )

      expect(response.status).toBe(200)
      expect(mockRecordDataProcessing).toHaveBeenCalledWith(
        expect.objectContaining({ dataType: 'loki_credential_erasure' })
      )
      expect(mockServiceClient.from).not.toHaveBeenCalledWith('guild_config')
    })

    it('aborts before Auth deletion when the purge proof is malformed', async () => {
      mockServiceClient.rpc.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const response = await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )

      expect(response.status).toBe(500)
      expect(mockServiceClient.auth.admin.deleteUser).not.toHaveBeenCalled()
    })

    it('executes DB-owned purge/revocation before Auth deletion', async () => {
      const order: string[] = []
      mockServiceClient.rpc.mockImplementation(async () => {
        order.push('prepare')
        return {
          data: {
            success: true,
            cleared_mapping_count: 1,
            deleted_mapping_count: 0,
            subject_authority_blocked: true,
            revoked_attestations: 1,
            purged_loki_credential_count: 0,
            purged_loki_guild_codes: [],
            binding_restorable: false
          },
          error: null
        }
      })
      mockServiceClient.auth.admin.deleteUser.mockImplementation(async () => {
        order.push('deleteUser')
        return { error: null }
      })

      await POST(
        createRequest({ userId: 'user123', confirmationPhrase: 'DELETE' })
      )

      expect(order).toEqual(['prepare', 'deleteUser'])
    })
  })
})
