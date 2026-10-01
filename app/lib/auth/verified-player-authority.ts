import 'server-only'

import type { Json, TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('auth.verified-player-authority')

const DISCORD_SNOWFLAKE = /^\d{17,20}$/
const RPC_BATCH_SIZE = 500

type RpcError = { message?: string | null; code?: string | null }
type RpcResult = { data: Json; error: RpcError | null }
type UnregisteredRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>
}

export interface VerifiedPlayerAuthority {
  mappingId: number
  playerId: string
  userId: string
  guildCode: string | null
  role: string | null
  isAppAdmin: boolean
  ownershipAttestationId: string
}

export interface VerifiedDiscordAuthority extends VerifiedPlayerAuthority {
  discordUserId: string
}

type RawVerifiedPlayer = {
  mapping_id?: number | null
  player_id?: string | null
  user_id?: string | null
  guild_code?: string | null
  role?: string | null
  is_app_admin?: boolean | null
  ownership_attestation_id?: string | null
  discord_user_id?: string | null
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function parseVerifiedPlayer(
  value: Json,
  requireDiscord: boolean
): VerifiedDiscordAuthority | VerifiedPlayerAuthority | null {
  if (!value || typeof value !== 'object') return null
  const row = value as RawVerifiedPlayer
  if (
    typeof row.mapping_id !== 'number' ||
    !Number.isSafeInteger(row.mapping_id) ||
    row.mapping_id <= 0 ||
    typeof row.player_id !== 'string' ||
    !row.player_id ||
    typeof row.user_id !== 'string' ||
    !row.user_id ||
    typeof row.ownership_attestation_id !== 'string' ||
    !row.ownership_attestation_id
  ) {
    return null
  }

  const base: VerifiedPlayerAuthority = {
    mappingId: row.mapping_id,
    playerId: row.player_id,
    userId: row.user_id,
    guildCode: typeof row.guild_code === 'string' ? row.guild_code : null,
    role: typeof row.role === 'string' ? row.role : null,
    isAppAdmin: row.is_app_admin === true,
    ownershipAttestationId: row.ownership_attestation_id
  }

  if (!requireDiscord) return base
  if (
    typeof row.discord_user_id !== 'string' ||
    !DISCORD_SNOWFLAKE.test(row.discord_user_id)
  ) {
    return null
  }
  return { ...base, discordUserId: row.discord_user_id }
}

async function resolveInBatches<T extends VerifiedPlayerAuthority>(
  supabase: TypedSupabaseClient,
  rpcName: string,
  argumentName: string,
  values: string[],
  requireDiscord: boolean
): Promise<T[]> {
  if (values.length === 0) return []

  const client = supabase as unknown as UnregisteredRpcClient
  const resolved: T[] = []
  for (const batch of chunks(values, RPC_BATCH_SIZE)) {
    const { data, error } = await client.rpc(rpcName, {
      [argumentName]: batch
    })
    if (error) {
      logger.warn(
        { rpcName, code: error.code, error: error.message },
        'Canonical authority lookup failed closed'
      )
      return []
    }
    if (!Array.isArray(data)) {
      logger.warn({ rpcName }, 'Canonical authority lookup returned non-array')
      return []
    }

    for (const value of data) {
      const parsed = parseVerifiedPlayer(value, requireDiscord)
      if (!parsed) {
        logger.warn(
          { rpcName },
          'Canonical authority lookup returned an invalid row'
        )
        return []
      }
      resolved.push(parsed as T)
    }
  }
  return resolved
}

/** Unverifiable rows are omitted; treat an empty result as denial. */
export async function resolveVerifiedPlayers(
  supabase: TypedSupabaseClient,
  userIds: readonly string[]
): Promise<VerifiedPlayerAuthority[]> {
  return resolveInBatches(
    supabase,
    'resolve_verified_players',
    'p_user_ids',
    uniqueNonEmpty(userIds),
    false
  )
}

/** Authoritative only when player ownership and the live auth.identities row agree. */
export async function resolveVerifiedDiscordIdentities(
  supabase: TypedSupabaseClient,
  discordUserIds: readonly string[]
): Promise<VerifiedDiscordAuthority[]> {
  const candidates = uniqueNonEmpty(discordUserIds).filter((value) =>
    DISCORD_SNOWFLAKE.test(value)
  )
  return resolveInBatches(
    supabase,
    'resolve_verified_discord_identities',
    'p_discord_user_ids',
    candidates,
    true
  )
}

export function findVerifiedDiscordForMapping(
  rows: readonly VerifiedDiscordAuthority[],
  candidate: {
    mappingId?: number | null
    playerId?: string | null
    userId?: string | null
    guildCode?: string | null
    discordUserId?: string | null
  }
): VerifiedDiscordAuthority | null {
  if (!candidate.discordUserId || !candidate.userId) return null
  const matches = rows.filter(
    (row) =>
      row.discordUserId === candidate.discordUserId &&
      row.userId === candidate.userId &&
      (candidate.mappingId == null || row.mappingId === candidate.mappingId) &&
      (candidate.playerId == null || row.playerId === candidate.playerId) &&
      (candidate.guildCode == null || row.guildCode === candidate.guildCode)
  )
  return matches.length === 1 ? matches[0]! : null
}
