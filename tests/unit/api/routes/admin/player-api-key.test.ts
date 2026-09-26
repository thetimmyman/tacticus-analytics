import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockLogApiKeyOperation: ReturnType<typeof vi.fn>

describe('Player API Key Admin Route', () => {
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockValidateApiKeyWithTacticus = vi.fn()
    mockEncryptApiKey = vi.fn()
    mockLogApiKeyOperation = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }))

    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus,
      logApiKeyOperation: mockLogApiKeyOperation
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { role: 'officer', guild_code: 'TEST' },
        error: null
      })
    })
  })

  describe('POST /api/admin/player-api-key', () => {
    let POST: (request: NextRequest) => Promise<Response>

    beforeEach(async () => {
      const routeModule = await import('@/app/api/admin/player-api-key/route')
      POST = routeModule.POST
    })

    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1', apiKey: 'test-key' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it('returns 400 for invalid request format', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: 'invalid json'
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.code).toBe(2001)
    })

    it('returns 400 when playerId or apiKey missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.code).toBe(2001) // VALIDATION error
    })

    it('returns 400 when API key validation fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Invalid API key'
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1', apiKey: 'invalid-key' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.code).toBe(2001) // VALIDATION error
    })

    it('returns 500 when encryption fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { name: 'Test Guild' }
      })

      mockEncryptApiKey.mockRejectedValue(new Error('Encryption failed'))

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1', apiKey: 'valid-key' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.code).toBe(5001)
    })

    it('returns 500 when RPC fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true
      })

      mockEncryptApiKey.mockResolvedValue('encrypted-key')

      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1', apiKey: 'valid-key' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.code).toBe(5001)
    })

    it('returns 400 when RPC returns unsuccessful result', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true
      })

      mockEncryptApiKey.mockResolvedValue('encrypted-key')

      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Permission denied' },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1', apiKey: 'valid-key' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it('successfully saves API key', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { name: 'Test Guild' }
      })

      mockEncryptApiKey.mockResolvedValue('encrypted-key')

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          message: 'API key saved',
          player_id: 'player-1',
          display_name: 'Test Player'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1', apiKey: 'valid-key' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.details.validated).toBe(true)
      expect(body.details.player_id).toBe('player-1')
    })
  })

  describe('DELETE /api/admin/player-api-key', () => {
    let DELETE: (request: NextRequest) => Promise<Response>

    beforeEach(async () => {
      const routeModule = await import('@/app/api/admin/player-api-key/route')
      DELETE = routeModule.DELETE
    })

    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key?playerId=player-1',
        { method: 'DELETE' }
      )

      const response = await DELETE(request)
      expect(response.status).toBe(401)
    })

    it('returns 400 when playerId missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.code).toBe(2001) // VALIDATION error
    })

    it('returns 500 when RPC fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key?playerId=player-1',
        { method: 'DELETE' }
      )

      const response = await DELETE(request)
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.code).toBe(5001)
    })

    it('returns 400 when RPC returns unsuccessful result', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Player not found' },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key?playerId=player-1',
        { method: 'DELETE' }
      )

      const response = await DELETE(request)
      expect(response.status).toBe(400)
    })

    it('successfully removes API key', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          message: 'API key removed',
          player_id: 'player-1',
          display_name: 'Test Player'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/player-api-key?playerId=player-1',
        { method: 'DELETE' }
      )

      const response = await DELETE(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.details.player_id).toBe('player-1')
    })
  })
})
