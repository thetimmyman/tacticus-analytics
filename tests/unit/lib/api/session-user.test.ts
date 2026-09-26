import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError, ErrorCode, Errors } from '@/app/lib/errors/AppError'

const mocks = vi.hoisted(() => ({ findActiveBanForAuthUser: vi.fn() }))

vi.mock('@/app/lib/auth/user-bans', () => ({
  findActiveBanForAuthUser: mocks.findActiveBanForAuthUser
}))

import { requireSessionUser } from '@/app/lib/api/session-user'

function makeSupabase(result: {
  data: { user: unknown }
  error: unknown
}): Pick<SupabaseClient, 'auth'> {
  return {
    auth: {
      getUser: async () => result
    }
  } as unknown as Pick<SupabaseClient, 'auth'>
}

describe('requireSessionUser', () => {
  beforeEach(() => {
    mocks.findActiveBanForAuthUser.mockReset()
    mocks.findActiveBanForAuthUser.mockResolvedValue(null)
  })

  it('returns the user when a session is present', async () => {
    const user = { id: 'user-1' }
    const supabase = makeSupabase({ data: { user }, error: null })
    await expect(requireSessionUser(supabase)).resolves.toBe(user)
  })

  it('throws the default AUTHENTICATION_REQUIRED body when error is set', async () => {
    const supabase = makeSupabase({
      data: { user: null },
      error: new Error('boom')
    })
    try {
      await requireSessionUser(supabase)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appErr = err as AppError
      expect(appErr.statusCode).toBe(401)
      expect(appErr.code).toBe(ErrorCode.AUTHENTICATION_REQUIRED)
      expect(appErr.message).toBe('Authentication required')
    }
  })

  it('throws with no session even when error is null', async () => {
    const supabase = makeSupabase({ data: { user: null }, error: null })
    await expect(requireSessionUser(supabase)).rejects.toBeInstanceOf(AppError)
  })

  it('throws the custom factory error exactly', async () => {
    const supabase = makeSupabase({ data: { user: null }, error: null })
    const custom = Errors.fromResponse(401, { error: 'Unauthorized' })
    try {
      await requireSessionUser(supabase, () => custom)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBe(custom)
    }
  })

  it('rejects a valid session when a durable ban matches', async () => {
    const user = { id: 'user-1' }
    mocks.findActiveBanForAuthUser.mockResolvedValue({ id: 'ban-1' })
    const supabase = makeSupabase({ data: { user }, error: null })

    try {
      await requireSessionUser(supabase)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).statusCode).toBe(403)
      expect((err as AppError).message).toBe('Account suspended')
    }
  })

  it('fails closed when durable ban verification fails', async () => {
    mocks.findActiveBanForAuthUser.mockRejectedValue(
      new Error('Unable to verify account access')
    )
    const supabase = makeSupabase({
      data: { user: { id: 'user-1' } },
      error: null
    })

    await expect(requireSessionUser(supabase)).rejects.toThrow(
      'Unable to verify account access'
    )
  })
})
