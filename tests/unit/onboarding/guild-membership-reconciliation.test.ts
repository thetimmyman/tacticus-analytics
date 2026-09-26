import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decryptApiKey: vi.fn(),
  getGuild: vi.fn(),
  invalidateClusterCache: vi.fn()
}))

vi.mock('@tacticus/app-core/cluster-cache', () => ({
  invalidateClusterCache: mocks.invalidateClusterCache
}))

vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: mocks.decryptApiKey
}))

vi.mock('@/app/lib/api/tacticus-client', () => ({
  tacticusAPI: { getGuild: mocks.getGuild }
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}))

import {
  captureGuildConflict,
  reconcileGuildConflict,
  type GuildConflictCandidate
} from '@/app/lib/onboarding/guild-membership-reconciliation'

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject)
  return chain
}

const candidate: GuildConflictCandidate = {
  mappingId: 17,
  playerId: 'player-1',
  sourceGuildCode: 'OLD1',
  sourceGuildId: 'old-guild-id'
}

const targetGuild = {
  guildId: 'target-guild-id',
  guildTag: 'NEW1',
  name: 'New Guild',
  level: 1,
  guildRaidSeasons: [],
  members: [{ userId: 'player-1', role: 'CO_LEADER', level: 50 }]
}

const oldGuildWithoutPlayer = {
  guildId: 'old-guild-id',
  guildTag: 'OLD1',
  name: 'Old Guild',
  level: 1,
  guildRaidSeasons: [],
  members: [{ userId: 'someone-else', role: 'LEADER', level: 50 }]
}

describe('guild membership reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decryptApiKey.mockResolvedValue('old-key')
  })

  it('drops the canonical cached scope after a successful move', async () => {
    // Guild (and maybe cluster) changed: invalidate the shared scope entry on every replica.
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: { guild_id: 'old-guild-id', api_key_encrypted: 'ciphertext' },
            error: null
          })
        ),
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, guild_code: 'NEW1' },
        error: null
      })
    }
    mocks.getGuild
      .mockResolvedValueOnce(targetGuild)
      .mockResolvedValueOnce(oldGuildWithoutPlayer)

    await reconcileGuildConflict({
      service: service as never,
      userId: 'user-1',
      apiKey: 'new-key',
      attemptGeneration: 7,
      targetGuildCode: 'NEW1',
      targetGuildId: 'target-guild-id',
      candidate
    })

    expect(mocks.invalidateClusterCache).toHaveBeenCalledWith('user-1')
  })

  it('fails CLOSED on a malformed roster instead of throwing a generic 500', async () => {
    // getGuild does not validate upstream JSON, so `members` may be absent, null or not an array.
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: { guild_id: 'old-guild-id', api_key_encrypted: 'ciphertext' },
            error: null
          })
        ),
      rpc: vi.fn()
    }
    mocks.getGuild
      .mockResolvedValueOnce({ ...targetGuild, members: null })
      .mockResolvedValueOnce(oldGuildWithoutPlayer)

    await expect(
      reconcileGuildConflict({
        service: service as never,
        userId: 'user-1',
        apiKey: 'new-key',
        attemptGeneration: 7,
        targetGuildCode: 'NEW1',
        targetGuildId: 'target-guild-id',
        candidate
      })
    ).rejects.toMatchObject({ statusCode: 409, name: 'AppError' })
    expect(service.rpc).not.toHaveBeenCalled()
  })

  it('captures exactly one current mapping in a different guild', async () => {
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({
            data: [{ id: 17, player_id: 'player-1', guild_code: 'OLD1' }],
            error: null
          })
        )
        .mockReturnValueOnce(
          query({ data: { guild_id: 'old-guild-id' }, error: null })
        )
    }

    await expect(
      captureGuildConflict({
        service: service as never,
        userId: 'user-1',
        targetGuildId: 'target-guild-id'
      })
    ).resolves.toEqual(candidate)
  })

  it('does nothing for an account without a current mapping', async () => {
    const service = {
      from: vi.fn().mockReturnValue(query({ data: [], error: null }))
    }
    await expect(
      captureGuildConflict({
        service: service as never,
        userId: 'user-1',
        targetGuildId: 'target-guild-id'
      })
    ).resolves.toBeNull()
  })

  it('moves a co-leader when the new roster includes them and the old roster does not', async () => {
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: {
              guild_id: 'old-guild-id',
              api_key_encrypted: 'ciphertext'
            },
            error: null
          })
        ),
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, guild_code: 'NEW1' },
        error: null
      })
    }
    mocks.getGuild
      .mockResolvedValueOnce(targetGuild)
      .mockResolvedValueOnce(oldGuildWithoutPlayer)

    const result = await reconcileGuildConflict({
      service: service as never,
      userId: 'user-1',
      apiKey: 'new-key',
      attemptGeneration: 7,
      targetGuildCode: 'NEW1',
      targetGuildId: 'target-guild-id',
      candidate
    })

    expect(result).toEqual({
      reconciled: true,
      sourceGuildCode: 'OLD1',
      targetGuildCode: 'NEW1'
    })
    expect(service.rpc).toHaveBeenCalledWith(
      'reconcile_own_guild_membership',
      expect.objectContaining({
        p_subject: 'user-1',
        p_player_id: 'player-1',
        p_source_guild: 'OLD1',
        p_source_guild_id: 'old-guild-id',
        p_target_guild: 'NEW1',
        p_target_guild_id: 'target-guild-id',
        p_target_role: 'leader',
        p_attempt_generation: 7,
        p_upstream_digest: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    )
  })

  it('accepts when the former stored credential now resolves to the same new guild', async () => {
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: {
              guild_id: 'old-guild-id',
              api_key_encrypted: 'ciphertext'
            },
            error: null
          })
        ),
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, guild_code: 'NEW1' },
        error: null
      })
    }
    mocks.getGuild
      .mockResolvedValueOnce(targetGuild)
      .mockResolvedValueOnce(targetGuild)

    await expect(
      reconcileGuildConflict({
        service: service as never,
        userId: 'user-1',
        apiKey: 'new-key',
        attemptGeneration: 7,
        targetGuildCode: 'NEW1',
        targetGuildId: 'target-guild-id',
        candidate
      })
    ).resolves.toEqual(expect.objectContaining({ reconciled: true }))
  })

  it('reports a superseded mutation fence as a retryable conflict', async () => {
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: {
              guild_id: 'old-guild-id',
              api_key_encrypted: 'ciphertext'
            },
            error: null
          })
        ),
      rpc: vi.fn().mockResolvedValue({
        data: { success: false, error_code: 'ATTEMPT_SUPERSEDED' },
        error: null
      })
    }
    mocks.getGuild
      .mockResolvedValueOnce(targetGuild)
      .mockResolvedValueOnce(oldGuildWithoutPlayer)

    await expect(
      reconcileGuildConflict({
        service: service as never,
        userId: 'user-1',
        apiKey: 'new-key',
        attemptGeneration: 7,
        targetGuildCode: 'NEW1',
        targetGuildId: 'target-guild-id',
        candidate
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('superseded')
    })
  })

  it('fails closed while Tacticus still lists the player in the former guild', async () => {
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: {
              guild_id: 'old-guild-id',
              api_key_encrypted: 'ciphertext'
            },
            error: null
          })
        ),
      rpc: vi.fn()
    }
    mocks.getGuild.mockResolvedValueOnce(targetGuild).mockResolvedValueOnce({
      ...oldGuildWithoutPlayer,
      members: [{ userId: 'player-1', role: 'CO_LEADER', level: 50 }]
    })

    await expect(
      reconcileGuildConflict({
        service: service as never,
        userId: 'user-1',
        apiKey: 'new-key',
        attemptGeneration: 7,
        targetGuildCode: 'NEW1',
        targetGuildId: 'target-guild-id',
        candidate
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(service.rpc).not.toHaveBeenCalled()
  })

  it('returns a retryable failure when either authoritative roster check is unavailable', async () => {
    const service = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: {
              guild_id: 'old-guild-id',
              api_key_encrypted: 'ciphertext'
            },
            error: null
          })
        ),
      rpc: vi.fn()
    }
    mocks.getGuild
      .mockResolvedValueOnce(targetGuild)
      .mockRejectedValueOnce(new Error('upstream unavailable'))

    await expect(
      reconcileGuildConflict({
        service: service as never,
        userId: 'user-1',
        apiKey: 'new-key',
        attemptGeneration: 7,
        targetGuildCode: 'NEW1',
        targetGuildId: 'target-guild-id',
        candidate
      })
    ).rejects.toMatchObject({ statusCode: 503 })
    expect(service.rpc).not.toHaveBeenCalled()
  })

  it('fails closed on a third-guild credential or ambiguous target roster', async () => {
    const makeService = () => ({
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({ data: { guild_id: 'target-guild-id' }, error: null })
        )
        .mockReturnValueOnce(
          query({
            data: {
              guild_id: 'old-guild-id',
              api_key_encrypted: 'ciphertext'
            },
            error: null
          })
        ),
      rpc: vi.fn()
    })

    mocks.getGuild.mockResolvedValueOnce(targetGuild).mockResolvedValueOnce({
      ...oldGuildWithoutPlayer,
      guildId: 'third-guild-id'
    })
    await expect(
      reconcileGuildConflict({
        service: makeService() as never,
        userId: 'user-1',
        apiKey: 'new-key',
        attemptGeneration: 7,
        targetGuildCode: 'NEW1',
        targetGuildId: 'target-guild-id',
        candidate
      })
    ).rejects.toMatchObject({ statusCode: 409 })

    mocks.getGuild.mockReset()
    mocks.getGuild
      .mockResolvedValueOnce({
        ...targetGuild,
        members: [...targetGuild.members, ...targetGuild.members]
      })
      .mockResolvedValueOnce(oldGuildWithoutPlayer)
    await expect(
      reconcileGuildConflict({
        service: makeService() as never,
        userId: 'user-1',
        apiKey: 'new-key',
        attemptGeneration: 7,
        targetGuildCode: 'NEW1',
        targetGuildId: 'target-guild-id',
        candidate
      })
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
