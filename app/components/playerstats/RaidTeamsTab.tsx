'use client'

import { useState, useEffect, useMemo } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import Image from 'next/image'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { dbClient } from '@/app/lib/db/client'
import { RAID_TEAMS } from '@/app/lib/constants/guild-raid-teams'
import { castRpcResult } from '@tacticus/app-core/database-extensions'
import { HeroRosterCell } from '@/app/(dashboard)/guild-teams/components/HeroRosterCell'
import { getRankIndexFromName } from '@/app/(dashboard)/roster/utils/roster-helpers'
import type { GuildTeamRosterEntry } from '@/app/(dashboard)/guild-teams/types'

interface RaidTeamsTabProps {
  playerName: string
  guildCode: string
}

const TIER_WEIGHTS: Record<string, number> = {
  core: 1,
  secondary: 0.5,
  tertiary: 1 / 3
}

const TIER_DOT: Record<string, string> = {
  core: 'bg-yellow-500',
  secondary: 'bg-blue-500',
  tertiary: 'bg-gray-500'
}

function heroScore(entry: GuildTeamRosterEntry | undefined | null): number {
  if (!entry || entry.stars == null) return -1
  const prog = entry.progression_index ?? entry.stars ?? 0
  const rank = entry.rank_name ? getRankIndexFromName(entry.rank_name) : 0
  const activeAbility = entry.active_ability_level ?? 0
  const passiveAbility = entry.passive_ability_level ?? 0
  return prog * 1000 + rank * 40 + activeAbility + passiveAbility
}

function weightedHeroScore(
  entry: GuildTeamRosterEntry | undefined | null,
  tier: string
): number {
  const raw = heroScore(entry)
  if (raw < 0) return raw
  return Math.round(raw * (TIER_WEIGHTS[tier] ?? 1))
}

export function RaidTeamsTab({ playerName, guildCode }: RaidTeamsTabProps) {
  const [loading, setLoading] = useState(true)
  const [rosterData, setRosterData] = useState<GuildTeamRosterEntry[]>([])
  const hasMounted = useHasMounted()

  const allUnitIds = useMemo(() => {
    const ids = new Set<string>()
    for (const team of RAID_TEAMS) {
      for (const hero of team.heroes) {
        ids.add(hero.unitId)
      }
    }
    return [...ids]
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      const supabase = dbClient()
      const { data } = await supabase.rpc('get_guild_team_roster', {
        p_guild_code: guildCode,
        p_unit_ids: allUnitIds
      })
      if (cancelled) return
      const rows = castRpcResult<GuildTeamRosterEntry[]>(data) ?? []
      setRosterData(rows.filter((r) => r.player_display_name === playerName))
      setLoading(false)
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [guildCode, playerName, allUnitIds])

  const heroMap = useMemo(() => {
    const map = new Map<string, GuildTeamRosterEntry>()
    for (const row of rosterData) {
      if (row.unit_id) map.set(row.unit_id, row)
    }
    return map
  }, [rosterData])

  const rankedTeams = useMemo(() => {
    return RAID_TEAMS.map((team) => {
      let totalScore = 0
      for (const hero of team.heroes) {
        const entry = heroMap.get(hero.unitId)
        const ws = weightedHeroScore(entry, hero.tier)
        if (ws > 0) totalScore += ws
      }
      return { team, totalScore }
    }).sort((a, b) => b.totalScore - a.totalScore)
  }, [heroMap])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (rosterData.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text-secondary)]">
        No roster data synced for this player yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {rankedTeams.map(({ team, totalScore }, idx) => (
        <div
          key={team.id}
          className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg overflow-hidden"
        >
          {/* Team header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--card-border)] bg-card/30">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[var(--text-secondary)] tabular-nums w-5">
                #{idx + 1}
              </span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {team.name}
              </span>
            </div>
            <span className="text-sm font-medium text-[var(--accent)] tabular-nums">
              {hasMounted ? totalScore.toLocaleString() : String(totalScore)}
            </span>
          </div>

          {/* All heroes in a single row */}
          <div className="flex flex-wrap gap-px px-3 py-2">
            {team.heroes.map((hero) => {
              const entry = heroMap.get(hero.unitId)
              return (
                <div
                  key={hero.unitId}
                  className="flex flex-col items-center w-[72px] min-w-[72px]"
                >
                  {/* Tier dot + icon + name */}
                  <div className="flex flex-col items-center gap-0.5 mb-0.5">
                    <div className="relative">
                      {entry?.web_icon_url ? (
                        <Image
                          src={entry.web_icon_url}
                          alt=""
                          width={24}
                          height={24}
                          className="rounded-sm"
                          unoptimized
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-sm bg-gray-700" />
                      )}
                      <span
                        className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${TIER_DOT[hero.tier]}`}
                      />
                    </div>
                    <span className="text-[9px] text-[var(--text-secondary)] leading-tight text-center truncate w-full px-0.5">
                      {hero.displayName}
                    </span>
                  </div>
                  {/* Roster data */}
                  <HeroRosterCell
                    data={entry ?? null}
                    isMow={entry?.category?.toLowerCase() === 'mow'}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
