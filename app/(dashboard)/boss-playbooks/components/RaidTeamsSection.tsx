'use client'

import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import Link from 'next/link'
import { Dna, Sword } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import TeamCompositionDisplay from '@/app/components/TeamCompositionDisplay'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'

type RaidTeamsSectionProps = {
  bossId: string
  bossName: string
}

type RaidTeam = {
  team_hash: string | null
  team_composition: string | null
  meta_team: string | null
  meta_team_id?: string | null
  rarity_set: string | null
  damage_p50?: number | null
  damage_p90?: number | null
  damage_p75?: number | null
  damage_avg?: number | null
  attack_count?: number | null
  season?: string | null
}

type RarityTeamsGroup = {
  rarity_set: string
  teams: RaidTeam[]
}

const parseTeamComposition = (
  composition: string | null | undefined
): string[] => {
  if (!composition) return []
  // ' + ' separates heroes from the MOW.
  const parts = composition.split(' + ')
  const heroPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null

  const heroes = heroPart
    .split(',')
    .map((hero) => hero.trim())
    .filter(Boolean)

  if (mowPart) {
    heroes.push(`[MOW]${mowPart}`)
  }
  return heroes
}

const getRaritySetColor = (rs: string): string => {
  const isMythic = rs.startsWith('M')
  return isMythic ? '#ff6b35' : '#93c5fd'
}

const sortRaritySets = (sets: string[]): string[] => {
  return [...sets].sort((a, b) => {
    const rankA = a.startsWith('M') ? 100 : 0
    const rankB = b.startsWith('M') ? 100 : 0
    const numA = parseInt(a.slice(1)) || 0
    const numB = parseInt(b.slice(1)) || 0
    return rankB + numB - (rankA + numA)
  })
}

export function RaidTeamsSection({ bossId, bossName }: RaidTeamsSectionProps) {
  const [rarityTeams, setRarityTeams] = useState<RarityTeamsGroup[]>([])
  const [availableRaritySets, setAvailableRaritySets] = useState<string[]>([])
  const [defaultRaritySets, setDefaultRaritySets] = useState<string[]>([])
  const [selectedRaritySets, setSelectedRaritySets] = useState<Set<string>>(
    new Set()
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  const sortedAvailable = useMemo(
    () => sortRaritySets(availableRaritySets),
    [availableRaritySets]
  )
  const sortedDefaults = useMemo(
    () => sortRaritySets(defaultRaritySets),
    [defaultRaritySets]
  )

  const fetchTeams = useCallback(
    async (raritySets?: string[]) => {
      setLoading(true)
      setError(null)
      try {
        const params =
          raritySets && raritySets.length > 0
            ? `?rarity_sets=${raritySets.join(',')}`
            : ''
        const teamsRes = await fetch(`/api/playbooks/${bossId}/teams${params}`)
        const teamsPayload = await teamsRes.json().catch(() => null)
        if (!teamsRes.ok) {
          throw new Error(
            extractErrorMessage(teamsPayload, 'Failed to load raid teams')
          )
        }
        setRarityTeams((teamsPayload?.rarity_teams as RarityTeamsGroup[]) || [])

        if (teamsPayload?.available_rarity_sets) {
          setAvailableRaritySets(teamsPayload.available_rarity_sets)
        }
        if (teamsPayload?.default_rarity_sets && !initialized) {
          setDefaultRaritySets(teamsPayload.default_rarity_sets)
          setSelectedRaritySets(new Set(teamsPayload.default_rarity_sets))
          setInitialized(true)
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load raid teams'
        )
      } finally {
        setLoading(false)
      }
    },
    [bossId, initialized]
  )

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

  useEffect(() => {
    if (initialized && selectedRaritySets.size > 0) {
      fetchTeams(Array.from(selectedRaritySets))
    }
  }, [fetchTeams, selectedRaritySets, initialized])

  const toggleRaritySet = useCallback((rs: string) => {
    setSelectedRaritySets((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(rs)) {
        // Never deselect the last one.
        if (next.size > 1) {
          next.delete(rs)
        }
      } else {
        next.add(rs)
      }
      return next
    })
  }, [])

  const resetToDefaults = useCallback(() => {
    setSelectedRaritySets(new Set(defaultRaritySets))
  }, [defaultRaritySets])

  const isDefaultSelection = useMemo(() => {
    if (selectedRaritySets.size !== sortedDefaults.length) return false
    return sortedDefaults.every((rs) => selectedRaritySets.has(rs))
  }, [selectedRaritySets, sortedDefaults])

  return (
    <div className="card-wh40k p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary-wh40k">
          <Sword className="h-4 w-4 text-(--accent)" />
          Raid Teams
        </div>
        <Link
          href={`/meta-atlas?boss=${encodeURIComponent(bossName)}`}
          className="text-xs text-(--accent) hover:text-[color-mix(in_srgb,var(--accent)_80%,transparent)] inline-flex items-center gap-1"
        >
          <Dna className="h-3.5 w-3.5" />
          View in Meta Atlas
        </Link>
      </div>

      {/* Rarity Set Filter Buttons */}
      {sortedAvailable.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-(--text-tertiary)">
            Rarity
          </span>
          {sortedAvailable.map((rs) => {
            const isActive = selectedRaritySets.has(rs)
            const color = getRaritySetColor(rs)
            return (
              <button
                key={rs}
                type="button"
                onClick={() => toggleRaritySet(rs)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border font-semibold transition-all"
                aria-pressed={isActive}
                style={
                  {
                    borderColor: color,
                    color: isActive ? color : 'var(--text-secondary)',
                    background: isActive
                      ? `color-mix(in srgb, ${color} 18%, transparent)`
                      : 'rgba(20, 20, 25, 0.7)',
                    boxShadow: isActive
                      ? `0 0 12px color-mix(in srgb, ${color} 25%, transparent)`
                      : 'none'
                  } as CSSProperties
                }
              >
                {rs}
              </button>
            )
          })}
          {!isDefaultSelection && sortedDefaults.length > 0 && (
            <button
              type="button"
              onClick={resetToDefaults}
              className="inline-flex items-center px-2.5 py-1 text-xs rounded-full border font-semibold transition-all"
              aria-label="Reset rarity filters"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                borderColor: 'rgba(255, 255, 255, 0.18)',
                color: 'var(--text-secondary)'
              }}
            >
              Reset
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="text-xs text-(--text-tertiary)">Loading teams...</div>
      )}
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {!loading && rarityTeams.every((group) => group.teams.length === 0) && (
        <div className="text-xs text-(--text-tertiary)">
          No meta teams available for this boss yet.
        </div>
      )}

      <div className="space-y-5">
        {rarityTeams.map((group) => (
          <div key={group.rarity_set} className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-(--text-tertiary)">
              Rarity Set {group.rarity_set}
            </div>
            {group.teams.length === 0 ? (
              <div className="text-xs text-(--text-tertiary)">
                No teams recorded for {group.rarity_set} yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {/* Ranked by P90 (fallback P50/avg), top pick badged. */}
                {[...group.teams]
                  .sort(
                    (a, b) =>
                      (b.damage_p90 ?? b.damage_p50 ?? b.damage_avg ?? -1) -
                      (a.damage_p90 ?? a.damage_p50 ?? a.damage_avg ?? -1)
                  )
                  .map((team, index) => {
                    const heroNames = parseTeamComposition(
                      team.team_composition
                    )
                    const heroDetails = JSON.stringify(
                      heroNames
                        .filter((name) => !name.startsWith('[MOW]'))
                        .map((unitId) => ({ unitId }))
                    )
                    const machineUnitId = heroNames
                      .find((name) => name.startsWith('[MOW]'))
                      ?.replace('[MOW]', '')
                    const machineOfWarDetails = machineUnitId
                      ? JSON.stringify({ unitId: machineUnitId })
                      : null
                    const p90 = team.damage_p90 ?? null
                    const p50 = team.damage_p50 ?? team.damage_avg ?? null
                    const isTopPick =
                      index === 0 && group.teams.length > 1 && p90 != null

                    return (
                      <div
                        key={`${group.rarity_set}-${team.team_hash ?? index}`}
                        className={`rounded-lg border p-2.5 space-y-1.5 ${
                          isTopPick
                            ? 'border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                            : 'border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            {isTopPick && (
                              <span className="inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent)">
                                Top P90
                              </span>
                            )}
                            {team.meta_team ? (
                              <MultipleCategoryBadges
                                categories={[team.meta_team]}
                                className="text-xs"
                              />
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-gray-400/20 text-gray-300">
                                Custom
                              </span>
                            )}
                          </span>
                          {team.season && (
                            <span className="text-[10px] text-(--text-tertiary)">
                              S{team.season}
                            </span>
                          )}
                        </div>
                        <TeamCompositionDisplay
                          heroDetails={heroDetails}
                          machineOfWarDetails={machineOfWarDetails}
                        />
                        <div className="flex flex-wrap gap-2 text-[10px] text-secondary-wh40k">
                          {p50 != null && (
                            <span>P50: {formatNumber(Math.round(p50))}</span>
                          )}
                          {p90 != null && (
                            <span>P90: {formatNumber(Math.round(p90))}</span>
                          )}
                          {team.attack_count != null && (
                            <span>{team.attack_count} atks</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
