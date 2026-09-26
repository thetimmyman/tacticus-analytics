'use client'

import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import {
  calculateVOTLWPoints,
  normalizeBattleEntry,
  type RawBattleEntry
} from '@/app/components/votlw/utils/votlwCalculations'
import type {
  PlayerPoints,
  SetWinner,
  SeasonResults,
  BattleEntry,
  TokenUsagePlayer
} from '@tacticus/app-core/votlw.types'

interface RpcSetWinnerRow {
  rarity: string
  set: number
  levelString: string
  bossName?: string | null
  gold?: { player?: string | null; value?: number | null } | null
  silver?: { player?: string | null; value?: number | null } | null
  bronze?: { player?: string | null; value?: number | null } | null
  mostDamage?: { player?: string | null; value?: number | null } | null
  sideBoss1?: { player?: string | null; value?: number | null } | null
  sideBoss2?: { player?: string | null; value?: number | null } | null
  biggestHit?: { player?: string | null; value?: number | null } | null
}

interface TokenUsageRow {
  display_name: string | null
  tokens_used: number | null
  max_possible_tokens: number | null
  first_token_time?: string | null
}

const mapBattleEntries = (raw?: RawBattleEntry[] | null): BattleEntry[] =>
  (raw ?? []).map((entry) => normalizeBattleEntry(entry))

const mapSetWinners = (rows?: RpcSetWinnerRow[] | null): SetWinner[] =>
  (rows ?? []).map((row) => ({
    rarity: row.rarity === 'Mythic' ? 'Mythic' : 'Legendary',
    set: row.set,
    levelString: row.levelString,
    bossName: row.bossName ?? 'Unknown Boss',
    gold: row.gold?.player ?? '',
    goldValue: row.gold?.value ?? undefined,
    silver: row.silver?.player ?? '',
    silverValue: row.silver?.value ?? undefined,
    bronze: row.bronze?.player ?? '',
    bronzeValue: row.bronze?.value ?? undefined,
    mostDamage: row.mostDamage?.player ?? '',
    mostDamageValue: row.mostDamage?.value ?? undefined,
    sideBoss1: row.sideBoss1?.player ?? '',
    sideBoss1Value: row.sideBoss1?.value ?? undefined,
    sideBoss2: row.sideBoss2?.player ?? '',
    sideBoss2Value: row.sideBoss2?.value ?? undefined,
    biggestHit: row.biggestHit?.player ?? '',
    biggestHitValue: row.biggestHit?.value ?? undefined
  }))

const mapTokenUsageRows = (rows?: TokenUsageRow[] | null): TokenUsagePlayer[] =>
  (rows ?? []).map((row) => ({
    display_name: row.display_name ?? 'Unknown',
    tokens_used: row.tokens_used ?? 0,
    max_possible_tokens: row.max_possible_tokens ?? 0,
    battles_fought: row.tokens_used ?? 0,
    first_token_time: row.first_token_time ?? undefined
  }))

interface VOTLWData {
  playerPoints: PlayerPoints[]
  setWinners: SetWinner[]
  seasonAwards: SeasonResults | null
  tokenOffenders: Set<string>
  offenderThreshold: number
  abuserThreshold: number
  applyTokenOffenderFiltering: boolean
}

async function fetchVOTLWData(
  selectedGuild: string,
  selectedSeason: string
): Promise<VOTLWData> {
  const supabase = dbClient()

  // `apply_token_offender_filtering` is missing from the generated DB types.
  type GuildConfigRow = {
    token_offender_threshold?: number | null
    token_abuser_threshold?: number | null
    apply_token_offender_filtering?: boolean | null
    cluster_code?: string | null
  }

  const { data: guildSettingsRaw } = await supabase
    .from('guild_config')
    .select(
      'token_offender_threshold, token_abuser_threshold, apply_token_offender_filtering, cluster_code'
    )
    .eq('guild_code', selectedGuild)
    .single<GuildConfigRow>()

  const guildSettings = guildSettingsRaw as GuildConfigRow | null
  const effectiveClusterCode = guildSettings?.cluster_code ?? null
  const threshold = guildSettings?.token_offender_threshold || 4
  const abuserThreshold = guildSettings?.token_abuser_threshold || 5
  const applyTokenOffenderFiltering = Boolean(
    guildSettings?.apply_token_offender_filtering
  )

  type VOTLWSeasonAwardsPayload = {
    all_battles?: RawBattleEntry[] | null
    bomb_data?: RawBattleEntry[] | null
  }
  type VOTLWMostImprovedPayload = {
    player?: string | null
    improvementPct?: number | null
  }

  const { data: seasonPayload, error: seasonPayloadError } = await supabase.rpc(
    'get_votlw_season_awards_data',
    {
      p_guild_code: selectedGuild,
      p_season: selectedSeason,
      p_cluster_code: effectiveClusterCode ?? undefined
    }
  )

  if (seasonPayloadError || !seasonPayload) {
    throw seasonPayloadError ?? new Error('Missing VOTLW season data')
  }

  const seasonAwardsPayload = seasonPayload as VOTLWSeasonAwardsPayload
  const battleEntries = mapBattleEntries(seasonAwardsPayload.all_battles)
  const bombEntries = mapBattleEntries(seasonAwardsPayload.bomb_data)

  const { data: remoteSetWinners, error: setWinnersError } = await supabase.rpc(
    'get_votlw_set_winners',
    {
      p_guild_code: selectedGuild,
      p_season: selectedSeason,
      p_cluster_code: effectiveClusterCode ?? undefined
    }
  )

  if (setWinnersError) {
    throw setWinnersError
  }
  const mappedSetWinners = mapSetWinners(
    remoteSetWinners as RpcSetWinnerRow[] | null
  )

  const { data: mostImprovedData, error: mostImprovedError } =
    await supabase.rpc('get_votlw_most_improved_player', {
      p_guild_code: selectedGuild,
      p_season: selectedSeason,
      p_cluster_code: effectiveClusterCode ?? undefined
    })

  if (mostImprovedError) {
    throw mostImprovedError
  }

  const mostImprovedDataResult =
    mostImprovedData as VOTLWMostImprovedPayload | null
  const mostImprovedOverride: SeasonResults['mostImproved'] | undefined =
    mostImprovedDataResult?.player
      ? {
          player: mostImprovedDataResult.player,
          improvementPct: mostImprovedDataResult.improvementPct ?? 0
        }
      : undefined

  const { data: tokenUsageRows, error: tokenUsageError } = await supabase
    .from('season_token_usage')
    .select('display_name,tokens_used,max_possible_tokens,first_token_time')
    .eq('guild_code', selectedGuild)
    .eq('season_id', selectedSeason)

  if (tokenUsageError) {
    throw tokenUsageError
  }

  const resolvedTokenUsage = mapTokenUsageRows(tokenUsageRows)
  const offenders = new Set<string>()
  resolvedTokenUsage.forEach((player: TokenUsagePlayer) => {
    const tokensBelow = player.max_possible_tokens - player.tokens_used
    if (tokensBelow >= threshold) {
      offenders.add(player.display_name)
    }
  })

  // max_possible_tokens is the full season cap (28), so mid-season everyone looks
  // like an offender. Only filter once the season is sealed.
  const { data: seasonCalRow } = await supabase
    .from('season_calendar')
    .select('ends_at')
    .eq('season_id', Number(selectedSeason))
    .maybeSingle<{ ends_at: string | null }>()

  const seasonEndsAt = seasonCalRow?.ends_at
    ? new Date(seasonCalRow.ends_at)
    : null
  const isSeasonSealed = seasonEndsAt ? seasonEndsAt < new Date() : false

  const effectiveFilteringActive = applyTokenOffenderFiltering && isSeasonSealed

  // Excluded from medals/awards. With filtering off or the season running,
  // offenders are reported for display only.
  const offendersForCalc = effectiveFilteringActive
    ? offenders
    : new Set<string>()

  // The precomputed set-winner and most-improved RPCs ignore the offender filter,
  // so bypass them when it is on and let the client engine recompute.
  const useServerOverrides = !effectiveFilteringActive
  const effectiveSetWinnersOverride =
    useServerOverrides && mappedSetWinners.length > 0
      ? mappedSetWinners
      : undefined
  const effectiveMostImprovedOverride = useServerOverrides
    ? mostImprovedOverride
    : mostImprovedOverride && !offenders.has(mostImprovedOverride.player)
      ? mostImprovedOverride
      : undefined

  const results = await calculateVOTLWPoints(
    battleEntries,
    bombEntries,
    offendersForCalc,
    resolvedTokenUsage,
    selectedGuild,
    selectedSeason,
    effectiveClusterCode,
    {
      setWinnersOverride: effectiveSetWinnersOverride,
      mostImprovedOverride: effectiveMostImprovedOverride
    }
  )

  const finalSetWinners = effectiveSetWinnersOverride
    ? effectiveSetWinnersOverride
    : results.setWinners

  return {
    playerPoints: results.playerPoints,
    setWinners: finalSetWinners,
    seasonAwards: results.seasonAwards,
    tokenOffenders: offenders,
    offenderThreshold: threshold,
    abuserThreshold,
    applyTokenOffenderFiltering
  }
}

export function useVOTLWData(selectedGuild: string, selectedSeason: string) {
  const enabled = Boolean(selectedGuild) && Boolean(selectedSeason)

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch
  } = useQuery({
    queryKey: ['votlw-data', selectedGuild, selectedSeason],
    queryFn: () => fetchVOTLWData(selectedGuild, selectedSeason),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000 // 5 minutes
  })

  const error =
    queryError instanceof Error
      ? queryError.message
      : queryError
        ? 'Failed to load VOTLW data'
        : null

  const playerPoints = data?.playerPoints ?? []
  const setWinners = data?.setWinners ?? []
  const seasonAwards = data?.seasonAwards ?? null
  const tokenOffenders = data?.tokenOffenders ?? new Set<string>()
  const offenderThreshold = data?.offenderThreshold ?? 4
  const abuserThreshold = data?.abuserThreshold ?? 5
  const applyTokenOffenderFiltering = data?.applyTokenOffenderFiltering ?? false

  const veteran = playerPoints[0] || null
  const runnerUp = playerPoints[1] || null

  return {
    loading: enabled && loading,
    error,
    veteran,
    runnerUp,
    playerPoints,
    setWinners,
    seasonAwards,
    tokenOffenders,
    offenderThreshold,
    abuserThreshold,
    applyTokenOffenderFiltering,
    refetch: () => refetch()
  }
}
