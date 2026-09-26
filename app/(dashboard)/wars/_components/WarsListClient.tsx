'use client'

import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import { buildActiveWarVisibilityFilter } from '@/app/lib/war/active-wars'
import { WarMatchCard } from './WarMatchCard'

interface WarMatchRow {
  war_id: string
  opponent_guild_name: string
  war_status: string
  war_result: string | null
  guild_score: number | null
  opponent_score: number | null
  war_start_date: string | null
  war_end_date: string | null
  war_season: number | null
  battlefield_level: number | null
}

const WAR_COLUMNS =
  'war_id, opponent_guild_name, war_status, war_result, guild_score, opponent_score, war_start_date, war_end_date, war_season, battlefield_level'

async function fetchWarList(guildCode: string) {
  const supabase = dbClient()
  const activeWarFilter = buildActiveWarVisibilityFilter()

  const [activeResult, completedResult] = await Promise.all([
    supabase
      .from('guild_war_matches')
      .select(WAR_COLUMNS)
      .eq('guild_code', guildCode)
      .eq('war_status', 'active')
      .or(activeWarFilter)
      .order('war_start_date', { ascending: false })
      .limit(10),
    // Unresolved wars keep 'Unknown Opponent' forever once completed.
    supabase
      .from('guild_war_matches')
      .select(WAR_COLUMNS)
      .eq('guild_code', guildCode)
      .eq('war_status', 'completed')
      .not('opponent_guild_name', 'is', null)
      .neq('opponent_guild_name', '')
      .neq('opponent_guild_name', 'Unknown Opponent')
      .order('war_end_date', { ascending: false })
      .limit(20)
  ])

  if (activeResult.error)
    throw new Error(
      `Failed to fetch active wars: ${activeResult.error.message}`
    )
  if (completedResult.error)
    throw new Error(
      `Failed to fetch completed wars: ${completedResult.error.message}`
    )

  return {
    activeWars: (activeResult.data as unknown as WarMatchRow[]) ?? [],
    completedWars: (completedResult.data as unknown as WarMatchRow[]) ?? []
  }
}

interface WarsListClientProps {
  guildCode: string
}

export default function WarsListClient({ guildCode }: WarsListClientProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['war-list', guildCode],
    queryFn: () => fetchWarList(guildCode),
    staleTime: 120_000,
    gcTime: 600_000
  })

  if (isLoading) {
    return (
      <div className="px-4 py-6 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            War Reports
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            Loading your guild&apos;s war history...
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card-wh40k p-3 h-24 animate-pulse">
              <div className="h-4 w-2/3 rounded bg-[var(--bg-secondary)]" />
              <div className="h-3 w-1/3 rounded bg-[var(--bg-secondary)] mt-2" />
              <div className="flex gap-1.5 mt-3">
                <div className="h-5 w-16 rounded bg-[var(--bg-secondary)]" />
                <div className="h-5 w-8 rounded bg-[var(--bg-secondary)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6 space-y-4">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          War Reports
        </h1>
        <div className="card-wh40k p-6 text-center">
          <p className="text-[var(--text-secondary)]">
            Failed to load war data.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-4 py-2 text-sm rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const rawData = data ?? { activeWars: [], completedWars: [] }
  // Keep prep-phase rows reachable before the opponent resolves.
  const activeWars = rawData.activeWars
  const completedWars = rawData.completedWars
  const hasNoWars = activeWars.length === 0 && completedWars.length === 0

  return (
    <div className="px-4 py-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          War Reports
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-2">
          Your guild&apos;s war history and performance analytics.
        </p>
      </div>

      {hasNoWars ? (
        <div className="card-wh40k p-6 text-center">
          <p className="text-[var(--text-secondary)]">
            No wars recorded yet. Wars will appear here once your guild starts
            tracking war data.
          </p>
        </div>
      ) : (
        <>
          {activeWars.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
                Active Wars
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeWars.map((war) => (
                  <WarMatchCard key={war.war_id} match={war} isActive />
                ))}
              </div>
            </section>
          )}

          {completedWars.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
                Recent Wars
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {completedWars.map((war) => (
                  <WarMatchCard key={war.war_id} match={war} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
