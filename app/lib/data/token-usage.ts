import { db } from '@/app/lib/db'
import { getGuildSettings } from '@/app/lib/calculations/guild-settings'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.token-usage')
import { recordCalculationMetric } from '@/app/lib/calculations/metrics'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { normalizeTokenUsageRow } from '@/app/lib/types/token-usage-rpc'
import type { TokenUsageRpcRowRaw } from '@/app/lib/types/token-usage-rpc'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'

const enableTokenUsageRPC =
  process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE_RPC !== 'false'

export interface TokenUsageData {
  player_id: string
  display_name: string
  tokens_used: number
  max_possible: number
  tokens_below_offender: boolean
  tokens_below_abuser: boolean
  boss_tokens?: number
  prime_tokens?: number
  bombs_used?: number
  bombs_available?: number
  burned_tokens?: number | null
  time_over_cap_seconds?: number | null
}

export async function getTokenUsage(
  guild: string,
  season: string,
  supabaseClient?: TypedSupabaseClient
): Promise<TokenUsageData[]> {
  if (!guild || !season) {
    throw new Error('Guild and season are required')
  }

  const startedAt = Date.now()
  const normalizedGuild = normalizeGuildIdentifier(guild)

  const supabase = supabaseClient ?? (await db())

  await getGuildSettings(normalizedGuild, supabase)

  if (!enableTokenUsageRPC) {
    throw new Error(
      'Token usage RPC is disabled; set NEXT_PUBLIC_ENABLE_TOKEN_USAGE_RPC=true'
    )
  }

  const { data, error } = (await supabase.rpc('get_token_usage_for_guild', {
    p_guild_code: normalizedGuild,
    p_season: season
  })) as {
    data: TokenUsageRpcRowRaw[] | null
    error: {
      name?: string
      message?: string
      code?: string
      details?: string
      hint?: string
    } | null
  }

  const hasError =
    error && (error.message || error.code || Object.keys(error).length > 0)
  if (hasError) {
    const errorMessage =
      error.message || error.code || error.details || 'Unknown RPC error'
    recordCalculationMetric({
      id: 'token_usage_server',
      strategy: 'guild-only-rpc',
      durationMs: Date.now() - startedAt,
      success: false,
      source: 'direct',
      errorName: error.name ?? error.code ?? errorMessage,
      filterCount: 2
    })
    logger.error(
      { code: error.code, details: error.details, hint: error.hint },
      `Token usage RPC failed: ${errorMessage}`
    )
    throw new Error(errorMessage)
  }

  if (data !== null && !Array.isArray(data)) {
    recordCalculationMetric({
      id: 'token_usage_server',
      strategy: 'guild-only-rpc',
      durationMs: Date.now() - startedAt,
      success: false,
      source: 'direct',
      errorName: 'invalid-shape',
      filterCount: 2
    })
    throw new Error('Token usage RPC returned non-array data')
  }

  const rows = data ?? []

  recordCalculationMetric({
    id: 'token_usage_server',
    strategy: 'guild-only-rpc',
    durationMs: Date.now() - startedAt,
    success: true,
    source: 'direct',
    filterCount: 2
  })

  return rows.map((row) => {
    const n = normalizeTokenUsageRow(row)
    return {
      ...n,
      burned_tokens: n.burned_tokens || undefined,
      time_over_cap_seconds: n.time_over_cap_seconds || undefined
    }
  })
}

export async function getTokenUsageSummary(guild: string, season: string) {
  const usage = await getTokenUsage(guild, season)

  const totalMembers = usage.length
  const totalTokensUsed = usage.reduce((sum, p) => sum + p.tokens_used, 0)
  const totalMaxPossible = usage.reduce((sum, p) => sum + p.max_possible, 0)
  const offenders = usage.filter((p) => p.tokens_below_offender).length
  const abusers = usage.filter((p) => p.tokens_below_abuser).length

  return {
    totalMembers,
    totalTokensUsed,
    totalMaxPossible,
    efficiency:
      totalMaxPossible > 0 ? (totalTokensUsed / totalMaxPossible) * 100 : 0,
    offenders,
    abusers
  }
}
