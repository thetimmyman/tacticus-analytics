import { type Database } from '@/app/lib/db'
import type { PostgrestError } from '@supabase/supabase-js'
import type { PlayerRole } from '@tacticus/app-core/types'
import {
  guildIdentitiesMatch,
  nullableGuildIdentitiesMatch
} from './guild-identity'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'

export interface CurrentMappingAuthorityRow {
  id: number
  user_id: string | null
  guild_code: string | null
  cluster_id: string | null
  cluster_code: string | null
  role: string | null
  is_current: boolean | null
}

export interface ClusterAuthorityTarget {
  id: string
  cluster_code: string
  guild_code: string
}

export interface MappingAssignmentOutcome {
  state: 'target' | 'prior' | 'unknown'
  patchOutcome: 'target' | 'error' | 'exception' | 'witness_mismatch'
  readOutcome?: 'target' | 'prior' | 'unknown' | 'error' | 'exception'
}

export interface GuildAuthorityRow {
  id: number
  guild_code: string
  guild_id: string | null
  cluster_id: string | null
  cluster_code: string | null
  is_cluster: boolean | null
  display_name?: string | null
}

export interface GuildAuthorityTarget {
  guild_code: string
  guild_id: string | null
  cluster_id: string
  cluster_code: string
  is_cluster: true
}

export interface GuildWriteOutcome {
  state: 'target' | 'prior' | 'absent' | 'unknown'
  writeOutcome: 'target' | 'error' | 'exception' | 'witness_mismatch'
  readOutcome?:
    'target' | 'prior' | 'absent' | 'unknown' | 'error' | 'exception'
  guild?: GuildAuthorityRow
}

interface GuildWriteResponse {
  data: GuildAuthorityRow | null
  error: PostgrestError | null
}

type GuildWriteAction = () => Promise<GuildWriteResponse>

type GuildWriteReconciliation =
  | {
      mode: 'existing'
      prior: GuildAuthorityRow
    }
  | {
      mode: 'insert'
    }

type MappingWitness = Pick<
  CurrentMappingAuthorityRow,
  | 'id'
  | 'user_id'
  | 'guild_code'
  | 'cluster_id'
  | 'cluster_code'
  | 'role'
  | 'is_current'
>

function guildTargetMatches(
  guild: GuildAuthorityRow | null,
  target: GuildAuthorityTarget,
  expectedId?: number
): guild is GuildAuthorityRow {
  return (
    guild != null &&
    (expectedId == null || guild.id === expectedId) &&
    guildIdentitiesMatch(guild.guild_code, target.guild_code) &&
    nullableGuildIdentitiesMatch(guild.guild_id, target.guild_id) &&
    guild.cluster_id === target.cluster_id &&
    guildIdentitiesMatch(guild.cluster_code, target.cluster_code) &&
    guild.is_cluster === target.is_cluster
  )
}

function guildPriorStateMatches(
  guild: GuildAuthorityRow | null,
  prior: GuildAuthorityRow
): guild is GuildAuthorityRow {
  return (
    guild?.id === prior.id &&
    guildIdentitiesMatch(guild.guild_code, prior.guild_code) &&
    nullableGuildIdentitiesMatch(guild.guild_id, prior.guild_id) &&
    nullableGuildIdentitiesMatch(guild.cluster_id, prior.cluster_id) &&
    nullableGuildIdentitiesMatch(guild.cluster_code, prior.cluster_code) &&
    guild.is_cluster === prior.is_cluster
  )
}

async function readGuildPostState(
  authority: Database,
  reconciliation: GuildWriteReconciliation,
  target: GuildAuthorityTarget
) {
  let read = authority
    .from('guild_config')
    .select(
      'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster, display_name'
    )

  read =
    reconciliation.mode === 'existing'
      ? read.eq('id', reconciliation.prior.id)
      : read.eq('guild_code', target.guild_code)

  return await read.maybeSingle()
}

/** A status-zero error can follow a committed write, so ambiguous responses are reconciled by readback. */
export async function writeAndReconcileGuildAuthority(
  authority: Database,
  reconciliation: GuildWriteReconciliation,
  target: GuildAuthorityTarget,
  write: GuildWriteAction
): Promise<GuildWriteOutcome> {
  let writeOutcome: GuildWriteOutcome['writeOutcome']

  try {
    const { data, error } = await write()
    const expectedId =
      reconciliation.mode === 'existing' ? reconciliation.prior.id : undefined
    if (!error && guildTargetMatches(data, target, expectedId)) {
      return { state: 'target', writeOutcome: 'target', guild: data }
    }
    writeOutcome = error ? 'error' : 'witness_mismatch'
  } catch {
    writeOutcome = 'exception'
  }

  try {
    const { data, error } = await readGuildPostState(
      authority,
      reconciliation,
      target
    )
    if (error) {
      return { state: 'unknown', writeOutcome, readOutcome: 'error' }
    }

    const expectedId =
      reconciliation.mode === 'existing' ? reconciliation.prior.id : undefined
    if (guildTargetMatches(data, target, expectedId)) {
      return {
        state: 'target',
        writeOutcome,
        readOutcome: 'target',
        guild: data
      }
    }
    if (
      reconciliation.mode === 'existing' &&
      guildPriorStateMatches(data, reconciliation.prior)
    ) {
      return {
        state: 'prior',
        writeOutcome,
        readOutcome: 'prior',
        guild: data
      }
    }
    if (reconciliation.mode === 'insert' && data == null) {
      return { state: 'absent', writeOutcome, readOutcome: 'absent' }
    }
    return {
      state: 'unknown',
      writeOutcome,
      readOutcome: 'unknown',
      ...(data ? { guild: data } : {})
    }
  } catch {
    return { state: 'unknown', writeOutcome, readOutcome: 'exception' }
  }
}

export function mappingAssignmentMatches(
  mapping: MappingWitness | null,
  expected: CurrentMappingAuthorityRow,
  userId: string,
  target: ClusterAuthorityTarget
): boolean {
  return (
    mapping?.id === expected.id &&
    mapping.user_id === userId &&
    mapping.role === expected.role &&
    mapping.is_current === true &&
    guildIdentitiesMatch(mapping.guild_code, target.guild_code) &&
    mapping.cluster_id === target.id &&
    guildIdentitiesMatch(mapping.cluster_code, target.cluster_code)
  )
}

export function mappingPriorStateMatches(
  mapping: MappingWitness | null,
  expected: CurrentMappingAuthorityRow,
  userId: string
): boolean {
  return (
    mapping?.id === expected.id &&
    mapping.user_id === userId &&
    mapping.role === expected.role &&
    mapping.is_current === expected.is_current &&
    nullableGuildIdentitiesMatch(mapping.guild_code, expected.guild_code) &&
    nullableGuildIdentitiesMatch(mapping.cluster_id, expected.cluster_id) &&
    nullableGuildIdentitiesMatch(mapping.cluster_code, expected.cluster_code)
  )
}

async function assignCurrentMappingToCluster(
  authority: Database,
  mapping: CurrentMappingAuthorityRow,
  userId: string,
  target: ClusterAuthorityTarget
) {
  if (!mapping.guild_code) {
    return {
      data: null,
      error: { code: 'MISSING_CANONICAL_GUILD' }
    }
  }

  // app_role has both casings: pin the authorized role, not literal 'leader'.
  const leaderRole = mapping.role as PlayerRole | null
  if (leaderRole === null || !isClusterLeaderRole(leaderRole)) {
    return {
      data: null,
      error: { code: 'MISSING_LEADER_ROLE' }
    }
  }

  let mappingUpdate = authority
    .from('player_mapping')
    .update({
      guild_code: target.guild_code,
      cluster_id: target.id,
      cluster_code: target.cluster_code,
      updated_at: new Date().toISOString()
    })
    .eq('id', mapping.id)
    .eq('user_id', userId)
    .eq('is_current', true)
    .eq('role', leaderRole)
    .eq('guild_code', mapping.guild_code)

  mappingUpdate =
    mapping.cluster_id != null
      ? mappingUpdate.eq('cluster_id', mapping.cluster_id)
      : mappingUpdate.is('cluster_id', null)
  mappingUpdate =
    mapping.cluster_code != null
      ? mappingUpdate.eq('cluster_code', mapping.cluster_code)
      : mappingUpdate.is('cluster_code', null)

  return await mappingUpdate
    .select(
      'id, user_id, guild_code, cluster_id, cluster_code, role, is_current'
    )
    .maybeSingle()
}

async function readExactMappingPostState(
  authority: Database,
  mapping: CurrentMappingAuthorityRow,
  userId: string
) {
  return await authority
    .from('player_mapping')
    .select(
      'id, user_id, guild_code, cluster_id, cluster_code, role, is_current'
    )
    .eq('id', mapping.id)
    .eq('user_id', userId)
    .maybeSingle()
}

export async function assignAndReconcileCurrentMapping(
  authority: Database,
  mapping: CurrentMappingAuthorityRow,
  userId: string,
  target: ClusterAuthorityTarget
): Promise<MappingAssignmentOutcome> {
  let patchOutcome: MappingAssignmentOutcome['patchOutcome']

  try {
    const { data, error } = await assignCurrentMappingToCluster(
      authority,
      mapping,
      userId,
      target
    )
    if (!error && mappingAssignmentMatches(data, mapping, userId, target)) {
      return { state: 'target', patchOutcome: 'target' }
    }
    patchOutcome = error ? 'error' : 'witness_mismatch'
  } catch {
    patchOutcome = 'exception'
  }

  try {
    const { data, error } = await readExactMappingPostState(
      authority,
      mapping,
      userId
    )
    if (error) {
      return { state: 'unknown', patchOutcome, readOutcome: 'error' }
    }
    if (mappingAssignmentMatches(data, mapping, userId, target)) {
      return { state: 'target', patchOutcome, readOutcome: 'target' }
    }
    if (mappingPriorStateMatches(data, mapping, userId)) {
      return { state: 'prior', patchOutcome, readOutcome: 'prior' }
    }
    return { state: 'unknown', patchOutcome, readOutcome: 'unknown' }
  } catch {
    return { state: 'unknown', patchOutcome, readOutcome: 'exception' }
  }
}
