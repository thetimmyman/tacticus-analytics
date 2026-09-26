import { describe, expect, it, vi } from 'vitest'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities,
  resolveVerifiedPlayers
} from '@/app/lib/auth/verified-player-authority'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

const playerRow = (overrides: Record<string, unknown> = {}) => ({
  mapping_id: 42,
  player_id: 'player-42',
  user_id: '11111111-1111-4111-8111-111111111111',
  guild_code: 'TEST',
  role: 'officer',
  is_app_admin: false,
  ownership_attestation_id: '22222222-2222-4222-8222-222222222222',
  ...overrides
})

function client(rpc: ReturnType<typeof vi.fn>): TypedSupabaseClient {
  return { rpc } as unknown as TypedSupabaseClient
}

describe('verified player authority resolvers', () => {
  it('deduplicates inputs and batches ownership lookups', async () => {
    const rpc = vi.fn().mockImplementation((_name, args) =>
      Promise.resolve({
        data: (args.p_user_ids as string[]).map((userId, index) =>
          playerRow({ mapping_id: index + 1, user_id: userId })
        ),
        error: null
      })
    )
    const userIds = Array.from({ length: 501 }, (_, index) => `user-${index}`)

    const rows = await resolveVerifiedPlayers(client(rpc), [
      ...userIds,
      userIds[0]!
    ])

    expect(rows).toHaveLength(501)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]![1].p_user_ids).toHaveLength(500)
    expect(rpc.mock.calls[1]![1].p_user_ids).toHaveLength(1)
  })

  it('fails the complete lookup closed on an RPC error or malformed row', async () => {
    const failedRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'denied' }
    })
    const malformedRpc = vi.fn().mockResolvedValue({
      data: [playerRow(), playerRow({ mapping_id: '42' })],
      error: null
    })

    await expect(
      resolveVerifiedPlayers(client(failedRpc), ['user'])
    ).resolves.toEqual([])
    await expect(
      resolveVerifiedPlayers(client(malformedRpc), ['user'])
    ).resolves.toEqual([])
  })

  it('rejects malformed snowflake candidates before calling Postgres', async () => {
    const rpc = vi.fn()

    const rows = await resolveVerifiedDiscordIdentities(client(rpc), [
      'not-a-snowflake',
      '<@123456789012345678>'
    ])

    expect(rows).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns only strict canonical Discord rows', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [playerRow({ discord_user_id: '123456789012345678' })],
      error: null
    })

    const rows = await resolveVerifiedDiscordIdentities(client(rpc), [
      '123456789012345678'
    ])

    expect(rows).toEqual([
      expect.objectContaining({
        mappingId: 42,
        discordUserId: '123456789012345678'
      })
    ])
  })

  it('requires exactly one full mapping match at a consumer boundary', () => {
    const row = {
      mappingId: 42,
      playerId: 'player-42',
      userId: 'user-42',
      guildCode: 'TEST',
      role: 'officer',
      isAppAdmin: false,
      ownershipAttestationId: 'attestation-42',
      discordUserId: '123456789012345678'
    }
    const candidate = {
      mappingId: 42,
      playerId: 'player-42',
      userId: 'user-42',
      guildCode: 'TEST',
      discordUserId: '123456789012345678'
    }

    expect(findVerifiedDiscordForMapping([row], candidate)).toEqual(row)
    expect(findVerifiedDiscordForMapping([row, row], candidate)).toBeNull()
    expect(
      findVerifiedDiscordForMapping([row], {
        ...candidate,
        userId: 'different-user'
      })
    ).toBeNull()
  })
})
