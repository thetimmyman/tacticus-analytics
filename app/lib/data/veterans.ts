import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.veterans')
import type { SupabaseClient } from '@supabase/supabase-js'

interface VeteranAggregateRPCRow {
  display_name: string
  seasons: string[]
}

interface PlayerRow {
  displayName: string | null
}

export interface VeteranStats {
  count: number
  seasons: string[]
  players?: string[]
}

const VETERAN_SEASON_COUNT = 5

export async function getVeteranStats(
  guildCode: string
): Promise<VeteranStats> {
  if (!guildCode) {
    throw new Error('Guild code is required')
  }

  const supabase = await db()

  // eslint-disable-next-line no-restricted-syntax
  const rpcResult = await (supabase as SupabaseClient).rpc(
    'get_guild_season_veterans',
    {
      p_guild_code: guildCode,
      p_season_count: VETERAN_SEASON_COUNT
    }
  )

  const { data: veteranRows, error: veteranError } = rpcResult as {
    data: VeteranAggregateRPCRow[] | null
    error: Error | null
  }

  if (!veteranError && veteranRows) {
    const seasons = veteranRows[0]?.seasons ?? []
    return {
      count: veteranRows.length,
      seasons,
      players: veteranRows.map((v) => v.display_name || 'Unknown').sort()
    }
  }

  logger.warn(
    {
      guildCode,
      error: veteranError
    },
    'get_guild_season_veterans RPC unavailable, falling back to client-side scan'
  )
  return getVeteranStatsLegacy(supabase, guildCode)
}

async function getVeteranStatsLegacy(
  supabase: Awaited<ReturnType<typeof db>>,
  guildCode: string
): Promise<VeteranStats> {
  const { data: seasons, error: seasonsError } = (await supabase
    .from('EOT_GR_data')
    .select('Season')
    .eq('Guild', guildCode)
    .order('startedOn', { ascending: false })
    .limit(10000)) as {
    data: { Season: string | null }[] | null
    error: Error | null
  }

  if (seasonsError) {
    logger.error({ err: seasonsError }, 'Error fetching seasons:')
    throw new Error('Failed to fetch seasons')
  }

  const uniqueSeasons = Array.from(
    new Set(
      (seasons ?? [])
        .map((s) => s.Season)
        .filter((season): season is string => Boolean(season))
    )
  )
  const sortedSeasons = uniqueSeasons.sort((a, b) => {
    const numA = parseInt(a, 10)
    const numB = parseInt(b, 10)
    return numB - numA
  })
  const lastNSeasons = sortedSeasons.slice(0, VETERAN_SEASON_COUNT)

  if (lastNSeasons.length < VETERAN_SEASON_COUNT) {
    return { count: 0, seasons: lastNSeasons, players: [] }
  }

  const playerSeasons: Record<string, Set<string>> = {}
  const seasonResults = await Promise.all(
    lastNSeasons.map(async (season) => {
      const result = await supabase
        .from('EOT_GR_data')
        .select('displayName')
        .eq('Guild', guildCode)
        .eq('Season', season)
        .order('startedOn', { ascending: false })
        .limit(10000)
      return result as { data: PlayerRow[] | null; error: Error | null }
    })
  )

  seasonResults.forEach((result, index) => {
    const season = lastNSeasons[index]
    if (!season) return
    result.data?.forEach((p) => {
      const playerName = p.displayName || 'Unknown'
      if (!playerSeasons[playerName]) {
        playerSeasons[playerName] = new Set()
      }
      playerSeasons[playerName].add(season)
    })
  })

  const veteranPlayers = Object.entries(playerSeasons)
    .filter(([, seasonSet]) => seasonSet.size === VETERAN_SEASON_COUNT)
    .map(([player]) => player)
    .sort()

  return {
    count: veteranPlayers.length,
    seasons: lastNSeasons,
    players: veteranPlayers
  }
}

export async function getDetailedVeteranStats(guildCode: string): Promise<{
  veterans: VeteranStats
  participationBySeasons: { seasons: number; playerCount: number }[]
  retentionRate: number
}> {
  const veterans = await getVeteranStats(guildCode)

  if (veterans.seasons.length < 2) {
    return {
      veterans,
      participationBySeasons: [],
      retentionRate: 0
    }
  }

  const supabase = await db()

  const participationBySeasons: { seasons: number; playerCount: number }[] = []

  for (let i = 1; i <= Math.min(5, veterans.seasons.length); i++) {
    const seasonsToCheck = veterans.seasons.slice(0, i)
    const playerSeasons: Record<string, Set<string>> = {}

    const results = await Promise.all(
      seasonsToCheck.map(async (season) => {
        const result = await supabase
          .from('EOT_GR_data')
          .select('displayName')
          .eq('Guild', guildCode)
          .eq('Season', season)
          .order('startedOn', { ascending: false })
          .limit(10000)
        return result as { data: PlayerRow[] | null; error: Error | null }
      })
    )

    results.forEach((result, index) => {
      const season = seasonsToCheck[index]
      if (!season) return
      result.data?.forEach((p) => {
        const playerName = p.displayName || 'Unknown'
        if (!playerSeasons[playerName]) {
          playerSeasons[playerName] = new Set()
        }
        playerSeasons[playerName].add(season)
      })
    })

    const playersWithAllSeasons = Object.values(playerSeasons).filter(
      (seasons) => seasons.size === i
    ).length

    participationBySeasons.push({
      seasons: i,
      playerCount: playersWithAllSeasons
    })
  }

  const oldestSeasonPlayers = participationBySeasons[0]?.playerCount || 0
  const retentionRate =
    oldestSeasonPlayers > 0 ? (veterans.count / oldestSeasonPlayers) * 100 : 0

  return {
    veterans,
    participationBySeasons,
    retentionRate
  }
}
