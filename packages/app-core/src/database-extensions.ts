/** Hand-written additions to the generated Database types, for use via type assertions. */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database as GeneratedDatabase } from './database.generated'

export interface ClusterBattleStats {
  cluster_code: string
  season: string
  active_players: number
  active_guilds: number
  max_loop: number
  total_battles: number
  total_bombs: number
  avg_damage: number
}

export interface GuildBattleStats {
  guild_code: string
  season: string
  active_players: number
  max_loop: number
  total_battles: number
  total_bombs: number
  avg_damage: number
}

export interface UserAuthContext {
  authenticated: boolean
  has_profile: boolean
  cluster_code: string | null
  guild_code: string | null
  role: string | null
  user_id: string
}

export interface VerifyPlayerResult {
  success: boolean
  player_id?: string
  display_name?: string
  guild_code?: string
  details?: string
  error?: string
  error_code?: string
}

export interface ClaimProfileResult {
  success: boolean
  error?: string
  error_code?: string
  details?: string
}

export interface ClusterIdentity {
  cluster_code: string
  cluster_name: string
  cluster_id: string
  description?: string
}

export interface MembershipCheckResult {
  authenticated: boolean
  membershipStatus: 'none' | 'pending' | 'member' | 'officer' | 'leader'
  guild_code?: string
  cluster_code?: string
  role?: string
}

export interface AdminActionResult {
  success: boolean
  error?: string
  message?: string
}

export interface WebhookConfig {
  id: string
  webhook_type: string
  webhook_url: string | null
  enabled: boolean
  description?: string
  guild_code?: string
  cluster_id?: string
  created_at?: string
  updated_at?: string
  updated_by?: string
}

export interface LeaderboardEntry {
  displayName: string
  userId: string
  Guild: string
  damageDealt: number
  completedOn: string
  heroDetails: string | null
  machineOfWarDetails: string | null
  tier: number
  loopIndex: number
}

// /explore reads the privacy-enforcing view (the base table is not granted); rows match the table.
type PublicGuildSnapshotRow =
  GeneratedDatabase['public']['Views']['public_guild_snapshots_explore']['Row']

export type GuildSnapshot = Omit<
  PublicGuildSnapshotRow,
  'explore_privacy_mode' | 'explore_obfuscation_percent'
> & {
  explore_privacy_mode?: string | string[] | null
  explore_obfuscation_percent?: number | null
  obfuscationPercent?: number
  originalTotalDamage?: number
  originalAvgDamagePerBattle?: number
  isObfuscated?: boolean
}

export interface MetaTeamPattern {
  team_name: string
  trigger_heroes: string[]
  match_type: string
}

/** Hand-maintained GDPR rows keep the narrow literal unions the generator widens to string. */
export interface GdprProcessingLogRow {
  id: string
  user_id: string
  data_type: string
  processing_purpose: string
  legal_basis:
    | 'consent'
    | 'contract'
    | 'legal_obligation'
    | 'vital_interests'
    | 'public_task'
    | 'legitimate_interest'
  timestamp: string
  retention_until: string | null
  consent_given: boolean | null
  created_at: string
}

export interface GdprDataExportRow {
  request_id: string
  user_id: string
  requested_at: string
  completed_at: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  data_package: unknown | null
  download_url: string | null
  expires_at: string | null
  created_at: string
  processing_started_at?: string | null
}

export interface GdprDeletionRequestRow {
  request_id: string
  user_id: string
  request_type: 'partial' | 'complete'
  requested_at: string
  scheduled_for: string
  completed_at: string | null
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled'
  data_categories: string[]
  created_at: string
}

export type ExtendedDatabase = GeneratedDatabase

export type CustomTable<T> = {
  Row: T
  Insert: Partial<T>
  Update: Partial<T>
  Relationships: []
}

export type GdprSupabaseClient = SupabaseClient<GeneratedDatabase>

export function castRpcResult<T>(data: unknown): T | null {
  if (data === null || data === undefined) return null
  return data as T
}

export function castQueryResult<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return []
  return data as T[]
}

export function castSingleResult<T>(data: unknown): T | null {
  if (data === null || data === undefined) return null
  return data as T
}
