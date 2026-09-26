import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import type { AppUser } from '@/app/types'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  loggerError: vi.fn()
}))

vi.unmock('@/app/lib/auth/user-bans')
vi.mock('@/app/lib/db', () => ({ serviceDb: mocks.serviceDb }))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: mocks.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}))

import {
  banSubjectsForAuthUser,
  banSubjectsForUser,
  credentialBanDuration,
  findActiveBanForAuthUser,
  findActiveBanForUser,
  findActivelyBannedAuthUserIds,
  normalizeBanSubjectValue
} from '@/app/lib/auth/user-bans'

function authUser(overrides: Partial<User> = {}): User {
  return {
    id: 'USER-1',
    email: ' Person@Example.COM ',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-08-01T00:00:00Z',
    identities: [],
    ...overrides
  }
}

function mockBanQuery(
  subjectResult: { data: unknown[] | null; error: unknown },
  mapping: {
    data: { discord_user_id: string | null; player_id: string | null } | null
    error: unknown
  } = { data: null, error: null },
  immutableResult: { data: unknown[] | null; error: unknown } = {
    data: [],
    error: null
  }
) {
  const immutableLimit = vi.fn().mockResolvedValue(immutableResult)
  const immutableQuery = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: immutableLimit
  }
  const or = vi.fn().mockResolvedValue(subjectResult)
  const inValues = vi.fn().mockReturnValue({ or })
  const is = vi.fn().mockReturnValue({ in: inValues })
  const select = vi
    .fn()
    .mockReturnValueOnce(immutableQuery)
    .mockReturnValueOnce({ is })
  const mappingQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(mapping)
  }
  const from = vi.fn((table: string) =>
    table === 'player_mapping' ? mappingQuery : { select }
  )
  const getUserById = vi.fn()
  mocks.serviceDb.mockReturnValue({
    auth: { admin: { getUserById } },
    from
  })
  return {
    from,
    select,
    is,
    inValues,
    or,
    immutableQuery,
    immutableLimit,
    mappingQuery,
    getUserById
  }
}

describe('user ban matching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes case and whitespace for stable identifier matching', () => {
    expect(normalizeBanSubjectValue(' Person@Example.COM ')).toBe(
      'person@example.com'
    )
  })

  it('derives the credential duration from the longest effective ban', () => {
    const now = Date.parse('2026-08-24T12:00:00Z')
    expect(
      credentialBanDuration(
        [
          { expires_at: '2026-08-24T13:00:00Z' },
          { expires_at: '2026-08-26T12:00:00Z' }
        ],
        now
      )
    ).toBe('172800s')
    expect(credentialBanDuration([], now)).toBe('none')
    expect(credentialBanDuration([{ expires_at: null }], now)).toMatch(/s$/)
  })

  it('builds durable subjects from an app user profile', () => {
    const user = {
      id: 'USER-1',
      email: 'Person@Example.COM',
      profile: {
        discord_user_id: '123456789012345678',
        player_id: 'PLAYER-9'
      }
    } as AppUser

    expect(banSubjectsForUser(user)).toEqual([
      { subject_type: 'user_id', subject_value: 'user-1' },
      { subject_type: 'email', subject_value: 'person@example.com' },
      {
        subject_type: 'discord_user_id',
        subject_value: '123456789012345678'
      },
      { subject_type: 'player_id', subject_value: 'player-9' }
    ])
  })

  it('extracts a Discord provider identity before onboarding', () => {
    const subjects = banSubjectsForAuthUser(
      authUser({
        identities: [
          {
            id: 'identity-1',
            user_id: 'USER-1',
            identity_id: 'identity-1',
            provider: 'discord',
            created_at: '2026-08-01T00:00:00Z',
            updated_at: '2026-08-01T00:00:00Z',
            last_sign_in_at: '2026-08-01T00:00:00Z',
            identity_data: { provider_id: '123456789012345678' }
          }
        ]
      })
    )

    expect(subjects).toContainEqual({
      subject_type: 'discord_user_id',
      subject_value: '123456789012345678'
    })
  })

  it('checks GoTrue provider identities on AppUser page boundaries', async () => {
    const discordIdentity = {
      id: 'identity-1',
      user_id: 'USER-1',
      identity_id: 'identity-1',
      provider: 'discord',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      last_sign_in_at: '2026-08-01T00:00:00Z',
      identity_data: { provider_id: '123456789012345678' }
    }
    const query = mockBanQuery({
      data: [
        {
          id: 'ban-provider',
          ban_group_id: 'group-provider',
          auth_user_id: 'original-account',
          subject_type: 'discord_user_id',
          subject_value: '123456789012345678',
          reason: 'provider identity ban',
          banned_at: '2026-08-24T00:00:00Z',
          expires_at: null
        }
      ],
      error: null
    })
    query.getUserById.mockResolvedValue({
      data: { user: authUser({ identities: [discordIdentity] }) },
      error: null
    })

    await expect(
      findActiveBanForUser({ id: 'USER-1' } as AppUser)
    ).resolves.toMatchObject({
      id: 'ban-provider',
      subject_type: 'discord_user_id'
    })
  })

  it('matches both the subject value and its type', async () => {
    mockBanQuery({
      data: [
        {
          id: 'ban-1',
          ban_group_id: 'group-1',
          subject_type: 'email',
          subject_value: 'person@example.com',
          reason: 'abuse',
          banned_at: '2026-08-24T00:00:00Z',
          expires_at: null
        }
      ],
      error: null
    })

    await expect(findActiveBanForAuthUser(authUser())).resolves.toMatchObject({
      id: 'ban-1',
      subject_type: 'email'
    })
  })

  it('matches immutable auth_user_id even after a selected email changes', async () => {
    mockBanQuery(
      { data: [], error: null },
      { data: null, error: null },
      {
        data: [
          {
            id: 'ban-immutable',
            ban_group_id: 'group-immutable',
            auth_user_id: 'user-1',
            subject_type: 'email',
            subject_value: 'old@example.com',
            reason: 'credential abuse',
            banned_at: '2026-08-24T00:00:00Z',
            expires_at: null
          }
        ],
        error: null
      }
    )

    await expect(
      findActiveBanForAuthUser(authUser({ email: 'new@example.com' }))
    ).resolves.toMatchObject({
      id: 'ban-immutable',
      auth_user_id: 'user-1'
    })
  })

  it('matches the current mapped player identity for session-only callers', async () => {
    mockBanQuery(
      {
        data: [
          {
            id: 'ban-1',
            ban_group_id: 'group-1',
            subject_type: 'player_id',
            subject_value: 'player-9',
            reason: 'abuse',
            banned_at: '2026-08-24T00:00:00Z',
            expires_at: null
          }
        ],
        error: null
      },
      {
        data: { discord_user_id: null, player_id: 'PLAYER-9' },
        error: null
      }
    )

    await expect(findActiveBanForAuthUser(authUser())).resolves.toMatchObject({
      id: 'ban-1',
      subject_type: 'player_id'
    })
  })

  it('ignores a same-value row belonging to a different subject type', async () => {
    mockBanQuery({
      data: [
        {
          id: 'ban-1',
          ban_group_id: 'group-1',
          subject_type: 'player_id',
          subject_value: 'user-1',
          reason: 'collision',
          banned_at: '2026-08-24T00:00:00Z',
          expires_at: null
        }
      ],
      error: null
    })

    await expect(findActiveBanForAuthUser(authUser())).resolves.toBeNull()
  })

  it('fails closed when the ledger lookup is ambiguous', async () => {
    mockBanQuery(
      { data: [], error: null },
      { data: null, error: null },
      { data: null, error: { message: 'database unavailable' } }
    )

    await expect(findActiveBanForAuthUser(authUser())).rejects.toThrow(
      'Unable to verify account access'
    )
    expect(mocks.loggerError).toHaveBeenCalled()
  })

  it('fails closed when mapped identity lookup is ambiguous', async () => {
    mockBanQuery(
      { data: [], error: null },
      { data: null, error: { message: 'database unavailable' } }
    )

    await expect(findActiveBanForAuthUser(authUser())).rejects.toThrow(
      'Unable to verify account access'
    )
    expect(mocks.loggerError).toHaveBeenCalled()
  })

  it('finds durable identity bans for coordinated admin promotion', async () => {
    const banRows = [
      {
        id: 'ban-1',
        ban_group_id: 'group-1',
        auth_user_id: 'original-account',
        subject_type: 'email',
        subject_value: 'person@example.com',
        reason: 'replacement account coverage',
        banned_at: '2026-08-24T00:00:00Z',
        expires_at: null
      }
    ]
    const getUserById = vi.fn(async (userId: string) => ({
      data: {
        user: authUser({
          id: userId,
          email:
            userId === 'user-1' ? 'person@example.com' : 'other@example.com'
        })
      },
      error: null
    }))
    const from = vi.fn((table: string) => {
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }

      let immutableAuthUserId: string | null = null
      let subjectValues: string[] = []
      const result = () => ({
        data: immutableAuthUserId
          ? banRows.filter((row) => row.auth_user_id === immutableAuthUserId)
          : banRows.filter((row) => subjectValues.includes(row.subject_value)),
        error: null
      })
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: string) => {
          if (column === 'auth_user_id') immutableAuthUserId = value
          return query
        }),
        is: vi.fn().mockReturnThis(),
        in: vi.fn((column: string, values: string[]) => {
          if (column === 'subject_value') subjectValues = values
          return query
        }),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(async () => result()),
        then: (
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (reason: unknown) => unknown
        ) => Promise.resolve(result()).then(resolve, reject)
      }
      return query
    })
    const client = {
      auth: { admin: { getUserById } },
      from
    } as unknown as TypedSupabaseClient

    await expect(
      findActivelyBannedAuthUserIds(['USER-2', 'user-1', 'USER-2'], client)
    ).resolves.toEqual(['user-1'])
    expect(getUserById).toHaveBeenCalledTimes(2)
  })
})
