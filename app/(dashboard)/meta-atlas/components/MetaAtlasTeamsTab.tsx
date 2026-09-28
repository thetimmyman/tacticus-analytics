'use client'

import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { DataErrorBoundary } from '@/app/components/error/DataErrorBoundary'
import { normalizeBossKey } from '@/app/lib/utils/bossNames'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { MetaFilterBar, type MetaFilterControls } from './MetaFilterBar'
import { RaritySetRow } from './RaritySetRow'
import { RosterROIWidget } from './RosterROIWidget'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import type { BossData, MetaFilters, RosterRoiEntry } from '../types'
import type { HeroMapping } from '../utils/hero-mapping'
import { usePlaybookStrengthOverridesBatch } from '../hooks/usePlaybookStrengthOverridesBatch'

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

type CurrentTeamsLookup = Record<string, { current_team?: string | null }>

type MetaAtlasTeamsTabProps = {
  filters: MetaFilters | null
  filtersLoading: boolean
  recsLoading: boolean
  heroMappings: HeroMappings
  rosterEntries: RosterInputEntry[]
  rosterRoiEntries: RosterRoiEntry[]
  rosterRoiLoading: boolean
  rosterRoiMessage?: string
  rosterError?: Error | null
  hasRoster: boolean
  abilityNotice?: string | null
  canPersonalize: boolean
  currentTeamsLoading: boolean
  currentTeamsLookup: CurrentTeamsLookup
  groupedByRaritySet: GroupedBossEntry[]
  displayBossCount: number
  availableMetaTeams: string[]
  availableRaritySets: string[]
  filterControls: MetaFilterControls
  currentSeason: string
  defaultViewMode?: 'global' | 'personal'
  showViewToggle?: boolean
  showRosterRoi?: boolean
}

export function MetaAtlasTeamsTab({
  filters,
  filtersLoading,
  recsLoading,
  heroMappings,
  rosterEntries,
  rosterRoiEntries,
  rosterRoiLoading,
  rosterRoiMessage,
  rosterError,
  hasRoster,
  abilityNotice,
  canPersonalize,
  currentTeamsLoading,
  currentTeamsLookup,
  groupedByRaritySet,
  displayBossCount,
  availableMetaTeams,
  availableRaritySets,
  filterControls,
  currentSeason,
  defaultViewMode = 'global',
  showViewToggle = true,
  showRosterRoi = true
}: MetaAtlasTeamsTabProps) {
  const [bossViewModes, setBossViewModes] = useState<
    Record<string, 'global' | 'personal'>
  >({})

  const getBossViewKey = useCallback(
    (bossType: string, raritySet: string) => `${bossType}|${raritySet}`,
    []
  )

  // One batch override fetch avoids an N+1 from each PersonalPotentialView.
  const strengthOverrideRequests = useMemo(() => {
    if (!hasRoster) return []

    const requests: Array<{
      bossType: string
      bossName?: string
      metaTeam: string
    }> = []

    groupedByRaritySet.forEach((group) => {
      // Same logic as PersonalPotentialView.
      const bossData = group.main || group.prime1 || group.prime2
      if (!bossData) return

      // Same fallback chain as PersonalPotentialView.
      const targetTeamInfo = bossData.target_team_info
      const fallbackRec = bossData.recommendations?.[0]
      const metaTeam = targetTeamInfo?.meta_team ?? fallbackRec?.meta_team

      if (metaTeam && group.bossType) {
        requests.push({
          bossType: group.bossType,
          bossName: bossData.boss_name ?? undefined,
          metaTeam
        })
      }
    })

    return requests
  }, [groupedByRaritySet, hasRoster])

  const strengthOverridesBatch = usePlaybookStrengthOverridesBatch(
    strengthOverrideRequests,
    { enabled: hasRoster && strengthOverrideRequests.length > 0 }
  )

  const handleBossViewChange = useCallback(
    (bossType: string, raritySet: string, mode: 'global' | 'personal') => {
      setBossViewModes((prev) => ({
        ...prev,
        [getBossViewKey(bossType, raritySet)]: mode
      }))
    },
    [getBossViewKey]
  )

  const handleSelectBoss = useCallback((bossType: string) => {
    if (typeof document === 'undefined') return
    const target = document.querySelector(`[data-boss-type="${bossType}"]`)
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  return (
    <div className="space-y-4">
      {abilityNotice && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="py-3">
            <div className="flex items-start gap-2 text-xs text-amber-100">
              <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
              <span>{abilityNotice}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {showRosterRoi && (
        <RosterROIWidget
          entries={rosterRoiEntries}
          isLoading={rosterRoiLoading}
          heroMappings={heroMappings}
          onSelectBoss={handleSelectBoss}
          hasRoster={hasRoster}
          rosterError={rosterError}
          message={rosterRoiMessage}
        />
      )}

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
          <span className="text-sm text-secondary-wh40k">
            Loading meta data...
          </span>
        </div>
      ) : displayBossCount === 0 ? (
        <Card className="bg-(--card-bg) border-(--card-border)">
          <CardContent className="py-8 text-center text-secondary-wh40k">
            No bosses match your filter. Try a different search term.
          </CardContent>
        </Card>
      ) : (
        <DataErrorBoundary fallbackMessage="Failed to load team recommendations">
          <div className="space-y-3">
            {groupedByRaritySet.map((group) => (
              <RaritySetRow
                key={group.key}
                raritySet={group.raritySet}
                bossName={getBossDisplayName(group.bossName)}
                bossType={group.bossType}
                main={group.main}
                prime1={group.prime1}
                prime2={group.prime2}
                heroMappings={heroMappings}
                rosterEntries={rosterEntries}
                viewMode={
                  bossViewModes[
                    getBossViewKey(group.bossType, group.raritySet)
                  ] || defaultViewMode
                }
                onViewModeChange={(mode) =>
                  handleBossViewChange(group.bossType, group.raritySet, mode)
                }
                canPersonalize={canPersonalize}
                showViewToggle={showViewToggle}
                personalizationLoading={currentTeamsLoading}
                anchorId={`boss-${normalizeBossKey(group.bossType) || group.bossType.toLowerCase()}-${group.raritySet.toLowerCase()}`}
                hasBattleHistory={Boolean(
                  currentTeamsLookup[group.bossType]?.current_team
                )}
                hasRoster={hasRoster}
                strengthOverridesLookup={strengthOverridesBatch.data}
              />
            ))}
          </div>
        </DataErrorBoundary>
      )}
    </div>
  )
}
