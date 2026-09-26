'use client'

import { useMemo } from 'react'
import { Card, CardContent } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { formatNumber } from '@tacticus/app-core/formatters'
import { DataErrorBoundary } from '@/app/components/error/DataErrorBoundary'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { getMetaTeamColorClasses } from '@/app/lib/meta/meta-team-styling'
import { normalizeBossKey } from '@/app/lib/utils/bossNames'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { MetaFilterBar, type MetaFilterControls } from './MetaFilterBar'
import { ConfidenceChip } from './ConfidenceChip'
import type { BossData, BossRecommendation, MetaFilters } from '../types'
import { resolveHeroMapping, type HeroMapping } from '../utils/hero-mapping'

type HeroMappings = Map<string, HeroMapping>

type GroupedBossEntry = {
  key: string
  raritySet: string
  bossName: string
  bossType: string
  main: BossData | null
  prime1: BossData | null
  prime2: BossData | null
}

type TopTeamsTabProps = {
  filters: MetaFilters | null
  filtersLoading: boolean
  recsLoading: boolean
  heroMappings: HeroMappings
  groupedByRaritySet: GroupedBossEntry[]
  displayBossCount: number
  availableMetaTeams: string[]
  availableRaritySets: string[]
  filterControls: MetaFilterControls
  currentSeason: string
}

/** 36px is the smallest identifiable size that fits six slots in 320px; steps up at `sm`/`xl`. */
const HERO_TILE = 'h-9 w-9 sm:h-10 sm:w-10 xl:h-12 xl:w-12'

function HeroTile({
  name,
  heroMappings
}: {
  name: string
  heroMappings: HeroMappings
}) {
  const mapping = resolveHeroMapping(name, heroMappings)
  const displayName = mapping?.display_name || name

  return mapping?.web_icon_url ? (
    <img
      src={mapping.web_icon_url}
      alt={displayName}
      title={displayName}
      className={`${HERO_TILE} shrink-0 rounded-md border border-white/10 bg-black/30`}
      loading="lazy"
    />
  ) : (
    <div
      className={`${HERO_TILE} shrink-0 rounded-md border border-white/10 bg-gray-700 flex items-center justify-center text-[10px] font-bold text-[var(--text-secondary)]`}
      title={name}
    >
      {name.slice(0, 2)}
    </div>
  )
}

function CompactTeamRow({
  rec,
  heroMappings
}: {
  rec: BossRecommendation
  heroMappings: HeroMappings
}) {
  const { heroes, mow } = useMemo(() => {
    const parts = rec.team_composition.split(' + ')
    const heroesPart = parts[0] || ''
    const mowPart = parts[1]?.trim() || null
    return {
      heroes: heroesPart
        .split(', ')
        .map((h) => h.trim())
        .filter(Boolean),
      mow: mowPart
    }
  }, [rec.team_composition])

  return (
    <div
      role="group"
      aria-label="Top team composition"
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {heroes.map((hero) => (
          <HeroTile
            key={`hero-${resolveHeroMapping(hero, heroMappings)?.unit_id || hero}`}
            name={hero}
            heroMappings={heroMappings}
          />
        ))}
        {/* Separator and MoW tile wrap together so a bare "+" is never stranded. */}
        {mow && (
          <span className="flex shrink-0 items-center gap-1">
            <span
              aria-hidden="true"
              className="mx-0.5 text-sm text-[var(--text-secondary)]"
            >
              +
            </span>
            <HeroTile name={mow} heroMappings={heroMappings} />
          </span>
        )}
      </div>
    </div>
  )
}

function CompactEncounter({
  data,
  label,
  heroMappings
}: {
  data: BossData
  label: string
  heroMappings: HeroMappings
}) {
  const topRec = data.recommendations[0]
  if (!topRec) return null

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--card-border)] bg-black/20 p-2 transition-colors hover:border-white/25">
      <div className="flex min-w-0 items-center gap-1.5">
        <BossPortrait
          bossName={data.boss_name}
          lookupName={data.boss_lookup_name}
          size="small"
          variant="icon"
          className="shrink-0"
        />
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {label}
        </span>
        <ConfidenceChip attackCount={topRec.attack_count} className="ml-auto" />
      </div>

      <CompactTeamRow rec={topRec} heroMappings={heroMappings} />

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {topRec.meta_team && (
          <span
            className={`px-1.5 py-0.5 text-[10px] rounded-full border font-medium ${getMetaTeamColorClasses(topRec.meta_team, false)}`}
          >
            {topRec.meta_team}
          </span>
        )}
        <span
          className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]"
          title="90th-percentile damage across recorded attacks"
        >
          P90{' '}
          <span className="font-semibold text-white">
            {formatNumber(Math.round(topRec.damage_p90))}
          </span>
        </span>
      </div>
    </div>
  )
}

export function TopTeamsTab({
  filters,
  filtersLoading,
  recsLoading,
  heroMappings,
  groupedByRaritySet,
  displayBossCount,
  availableMetaTeams,
  availableRaritySets,
  filterControls,
  currentSeason
}: TopTeamsTabProps) {
  const getRaritySetBadgeStyle = (rs: string): string => {
    const isMythic = rs.startsWith('M')
    return isMythic
      ? 'bg-orange-500/30 text-orange-300 border-orange-500/50'
      : 'bg-cyan-500/30 text-cyan-300 border-cyan-500/50'
  }

  return (
    <div className="space-y-4">
      <MetaFilterBar
        {...filterControls}
        raritySets={availableRaritySets}
        metaTeams={availableMetaTeams}
        currentSeason={currentSeason}
        currentSeasonBosses={filters?.current_season_bosses || []}
        allBosses={filters?.bosses || []}
      />

      {filtersLoading || recsLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <LoadingSpinner />
          <span className="text-sm text-[var(--text-secondary)]">
            Loading meta data...
          </span>
        </div>
      ) : displayBossCount === 0 ? (
        <Card className="bg-[var(--card-bg)] border-[var(--card-border)]">
          <CardContent className="py-8 text-center text-[var(--text-secondary)]">
            No bosses match your filter. Try a different search term.
          </CardContent>
        </Card>
      ) : (
        <DataErrorBoundary fallbackMessage="Failed to load top teams">
          <div className="space-y-2">
            {groupedByRaritySet.map((group) => {
              const encounters = [
                { data: group.main, label: 'Main' },
                { data: group.prime1, label: 'Prime 1' },
                { data: group.prime2, label: 'Prime 2' }
              ].filter(
                (e): e is { data: BossData; label: string } =>
                  e.data !== null && e.data.recommendations.length > 0
              )

              if (encounters.length === 0) return null

              return (
                <Card
                  key={group.key}
                  id={`boss-${normalizeBossKey(group.bossType) || group.bossType.toLowerCase()}-${group.raritySet.toLowerCase()}`}
                  data-boss-type={group.bossType}
                  className="min-w-0 overflow-hidden bg-[var(--card-bg)] border-[var(--card-border)] transition-colors hover:border-white/20"
                >
                  <CardContent className="min-w-0 py-3 px-3">
                    <div className="mb-2 flex min-w-0 items-center gap-2 border-b border-[var(--card-border)] pb-2">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-full border font-medium ${getRaritySetBadgeStyle(group.raritySet)}`}
                      >
                        {group.raritySet}
                      </span>
                      <BossPortrait
                        bossName={group.bossName}
                        lookupName={
                          (group.main || group.prime1 || group.prime2)
                            ?.boss_lookup_name || group.bossType
                        }
                        size="small"
                        variant="icon"
                        className="shrink-0"
                      />
                      <span className="min-w-0 truncate text-base font-semibold tracking-tight text-white">
                        {getBossDisplayName(group.bossName)}
                      </span>
                    </div>
                    {/* All encounters side by side or none (partial splits orphan one). Plain fractions, not
                        auto-fit/minmax: WebKit grid sizing differs and is untested. */}
                    <div
                      className={`grid min-w-0 gap-2 ${
                        encounters.length === 1
                          ? 'grid-cols-1'
                          : encounters.length === 2
                            ? 'grid-cols-1 lg:grid-cols-2'
                            : 'grid-cols-1 lg:grid-cols-3'
                      }`}
                    >
                      {encounters.map(({ data, label }) => (
                        <CompactEncounter
                          key={label}
                          data={data}
                          label={label}
                          heroMappings={heroMappings}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </DataErrorBoundary>
      )}
    </div>
  )
}
