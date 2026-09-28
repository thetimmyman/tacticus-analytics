'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'
import {
  extractBadge,
  resolveHeroPortrait
} from '@/app/lib/catalogs/hero-portrait-resolver'
import { usePlayerRoster } from '@/app/lib/hooks/shared'
import type { RosterHero } from '@/app/lib/hooks/shared/types'
import WarPageHeader from '../../_components/WarPageHeader'
import {
  formatNumber,
  formatPercent,
  UnitPortrait,
  UnitRow
} from '../../_components/war-shared'
import { useTeamAnalysis } from '../../_hooks'
import type { Unit } from '../../_types'
import { zoneDisplayName } from '@/app/lib/war/war-naming'
import {
  getRarityFromProgressionIndex,
  getRarityColor
} from '@/app/(dashboard)/roster/utils/roster-helpers'
import { StarDisplayFromCount } from '@/app/components/StarDisplay'
import { RankIcon } from '@/app/(dashboard)/roster/components/RankIcon'

const MAX_TEAM_SIZE = 5

const normalizeKey = normalizeIdentifier

export default function TeamAnalyzerPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [useRosterPool, setUseRosterPool] = useState(true)
  const { data: heroCatalog } = useHeroCatalog()
  const rosterQuery = usePlayerRoster()
  const teamAnalysisMutation = useTeamAnalysis()

  const rosterHeroes = rosterQuery.heroes
  const rosterLoading = rosterQuery.isLoading
  const rosterError = rosterQuery.error
  const rosterConnected = rosterHeroes.length > 0 && !rosterError
  const rosterErrorMessage =
    rosterError instanceof Error ? rosterError.message : null
  const rosterIssue = rosterErrorMessage?.toLowerCase().includes('api key')
    ? 'API key missing'
    : rosterErrorMessage
      ? 'Roster unavailable'
      : null

  const resolveRosterPortrait = useCallback(
    (hero: RosterHero): string | undefined => {
      for (const key of [hero.engineId, hero.id, hero.name]) {
        if (!key) continue
        const { portraitUrl } = resolveHeroPortrait(key, heroCatalog)
        if (portraitUrl) return portraitUrl
      }
      return undefined
    },
    [heroCatalog]
  )

  const buildRosterUnit = useCallback(
    (hero: RosterHero) => {
      const name = hero.name?.trim() || hero.engineId || hero.id
      // Raw Loki id first: attacker_units_json stores Loki keys and the RPC does exact array equality.
      const id = hero.id || hero.engineId || normalizeKey(name)
      return {
        id,
        name,
        shortCode: extractBadge(name),
        portraitUrl: resolveRosterPortrait(hero),
        faction: hero.faction,
        rank: hero.rank,
        starLevel: hero.starLevel,
        progressionIndex: hero.progressionIndex
      }
    },
    [resolveRosterPortrait]
  )

  const rosterPool = useMemo(
    () => rosterHeroes.map(buildRosterUnit),
    [rosterHeroes, buildRosterUnit]
  )

  // Keyed like buildRosterUnit(hero).id (Loki id first).
  const rosterHeroMap = useMemo(() => {
    const map = new Map<string, RosterHero>()
    rosterHeroes.forEach((hero) => {
      const id = hero.id || hero.engineId
      if (!id) return
      map.set(id, hero)
    })
    return map
  }, [rosterHeroes])

  const rosterStats = useMemo(() => {
    if (rosterHeroes.length === 0) return null
    const legendary = rosterHeroes.filter((hero) => {
      const level = hero.progressionIndex ?? 0
      return level >= 12 && level < 16
    }).length
    const mythic = rosterHeroes.filter(
      (hero) => (hero.progressionIndex ?? 0) >= 16
    ).length
    const topUnits = [...rosterHeroes]
      .sort((a, b) => (b.progressionIndex ?? 0) - (a.progressionIndex ?? 0))
      .slice(0, 6)
      .map(buildRosterUnit)

    return {
      total: rosterHeroes.length,
      legendary,
      mythic,
      topUnits
    }
  }, [rosterHeroes, buildRosterUnit])

  const catalogPool = useMemo(() => {
    if (!heroCatalog) return []
    return heroCatalog.getAll().map((hero) => ({
      id: hero.unitId,
      name: hero.displayName,
      shortCode: extractBadge(hero.displayName),
      portraitUrl: hero.iconUrl || undefined,
      faction: hero.faction
    }))
  }, [heroCatalog])

  const heroPool = useMemo<Unit[]>(() => {
    return useRosterPool && rosterPool.length > 0 ? rosterPool : catalogPool
  }, [rosterPool, useRosterPool, catalogPool])
  const heroPoolIdSet = useMemo(
    () => new Set(heroPool.map((unit) => unit.id)),
    [heroPool]
  )
  const normalizedSelectedIds = useMemo(
    () => selectedIds.filter((id) => heroPoolIdSet.has(id)),
    [heroPoolIdSet, selectedIds]
  )

  const selectedUnits = useMemo(
    () => heroPool.filter((unit) => normalizedSelectedIds.includes(unit.id)),
    [heroPool, normalizedSelectedIds]
  )

  const toggleUnit = (unitId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(unitId)) {
        return prev.filter((id) => id !== unitId)
      }
      if (prev.length >= MAX_TEAM_SIZE) return prev
      return [...prev, unitId]
    })
  }

  const isReady = selectedUnits.length === MAX_TEAM_SIZE

  const analysisData = teamAnalysisMutation.data
  const hasData = analysisData && analysisData.totalUsed > 0

  const handleRunAnalysis = () => {
    if (isReady) {
      teamAnalysisMutation.mutate(normalizedSelectedIds)
    }
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <WarPageHeader
        title="Team Analyzer"
        description="Select 5 heroes to preview matchup performance and zone tendencies."
      />

      <Card className="border-(--border) bg-(--bg-primary)">
        <CardHeader className="pb-2">
          <CardTitle>Roster Connection</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={
                rosterConnected
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-(--bg-secondary) text-secondary-wh40k border-(--border)'
              }
            >
              {rosterConnected ? 'Roster connected' : 'Roster not connected'}
            </Badge>
            {rosterIssue && <Badge variant="warning">{rosterIssue}</Badge>}
            <Button
              variant="outline"
              size="sm"
              loading={rosterLoading}
              loadingText="Syncing roster"
              onClick={() => rosterQuery.refetch()}
            >
              Refresh roster
            </Button>
            <Button
              variant={useRosterPool ? 'default' : 'outline'}
              size="sm"
              disabled={!rosterConnected}
              onClick={() => setUseRosterPool(true)}
            >
              Use roster pool
            </Button>
            <Button
              variant={!useRosterPool ? 'default' : 'outline'}
              size="sm"
              onClick={() => setUseRosterPool(false)}
            >
              Use all heroes
            </Button>
          </div>
          {rosterErrorMessage && (
            <div className="text-xs text-(--text-tertiary)">
              {rosterErrorMessage}
            </div>
          )}
          {rosterStats ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1">
                  <div className="text-xs text-(--text-tertiary)">
                    Roster size
                  </div>
                  <div className="text-lg font-semibold text-primary-wh40k">
                    {formatNumber(rosterStats.total)} heroes
                  </div>
                </div>
                <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1">
                  <div className="text-xs text-(--text-tertiary)">
                    Legendary+
                  </div>
                  <div className="text-lg font-semibold text-primary-wh40k">
                    {formatNumber(rosterStats.legendary)}
                  </div>
                </div>
                <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1">
                  <div className="text-xs text-(--text-tertiary)">Mythic</div>
                  <div className="text-lg font-semibold text-primary-wh40k">
                    {formatNumber(rosterStats.mythic)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-secondary-wh40k">
                <span>Top heroes</span>
                <UnitRow units={rosterStats.topUnits} size="sm" />
              </div>
            </>
          ) : (
            <div className="text-sm text-secondary-wh40k">
              Connect your roster to personalize the hero pool for analysis.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-(--border) bg-(--bg-primary)">
        <CardHeader className="pb-2">
          <CardTitle>Selected Team</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 flex flex-wrap items-center gap-3">
          {(['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'] as const).map(
            (slotKey, slotIndex) => {
              const unit = selectedUnits[slotIndex]
              return unit ? (
                <UnitPortrait key={unit.id} unit={unit} size="lg" />
              ) : (
                <div
                  key={slotKey}
                  className="h-12 w-12 rounded-full border border-dashed border-(--border) text-(--text-tertiary) flex items-center justify-center text-xs"
                >
                  Slot {slotIndex + 1}
                </div>
              )
            }
          )}
          <Badge className="bg-(--bg-secondary) text-secondary-wh40k border-(--border)">
            {selectedUnits.length}/{MAX_TEAM_SIZE} selected
          </Badge>
        </CardContent>
      </Card>

      <Card className="border-(--border) bg-(--bg-primary)">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Hero Pool</CardTitle>
            <Badge className="bg-(--bg-secondary) text-secondary-wh40k border-(--border)">
              {formatNumber(heroPool.length)} heroes
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {heroPool.map((unit) => {
            const isSelected = selectedIds.includes(unit.id)
            return (
              <button
                key={unit.id}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  isSelected
                    ? 'border-accent-wh40k bg-(--bg-secondary)'
                    : 'border-(--border) hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)]'
                }`}
                onClick={() => toggleUnit(unit.id)}
              >
                <div className="flex items-center gap-3">
                  <UnitPortrait unit={unit} size="md" />
                  <div className="min-w-0">
                    <div className="font-semibold text-primary-wh40k truncate">
                      {unit.name}
                    </div>
                    <div className="text-xs text-(--text-tertiary) flex items-center gap-1">
                      <span>
                        {unit.faction ||
                          (useRosterPool && rosterPool.length > 0
                            ? 'Roster'
                            : 'Unknown')}
                      </span>
                      {unit.progressionIndex != null && (
                        <span
                          className={getRarityColor(
                            getRarityFromProgressionIndex(unit.progressionIndex)
                          )}
                        >
                          ·{' '}
                          {getRarityFromProgressionIndex(unit.progressionIndex)}
                        </span>
                      )}
                    </div>
                    {(unit.rank != null || unit.starLevel != null) &&
                      (() => {
                        const rh = rosterHeroMap.get(unit.id)
                        const abilityLevels = rh?.abilities
                          ?.filter((a) => (a.level ?? 0) > 0)
                          .map((a) => a.level ?? 0)
                        return (
                          <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                            {unit.rank != null && (
                              <RankIcon rank={unit.rank} size="sm" showLabel />
                            )}
                            {unit.starLevel != null && unit.starLevel > 0 && (
                              <StarDisplayFromCount
                                stars={unit.starLevel}
                                size="sm"
                              />
                            )}
                            {rh?.xpLevel != null && (
                              <span className="text-(--text-tertiary)">
                                Lv.{rh.xpLevel}
                              </span>
                            )}
                            {abilityLevels && abilityLevels.length > 0 && (
                              <span className="text-(--text-tertiary)">
                                {abilityLevels.join('·')}
                              </span>
                            )}
                          </div>
                        )
                      })()}
                  </div>
                </div>
              </button>
            )
          })}
        </CardContent>
      </Card>

      <Card className="border-(--border) bg-(--bg-primary)">
        <CardHeader className="pb-2">
          <CardTitle>Analysis Results</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-5">
          {!isReady && (
            <div className="text-sm text-secondary-wh40k">
              Select {MAX_TEAM_SIZE - selectedUnits.length} more heroes to run
              analysis.
            </div>
          )}
          {isReady && teamAnalysisMutation.isPending && (
            <div className="text-center py-12 text-secondary-wh40k">
              Analyzing team composition...
            </div>
          )}
          {isReady && teamAnalysisMutation.isError && (
            <div className="text-center py-12 text-red-400">
              Failed to analyze team. Please try again.
            </div>
          )}
          {isReady && !teamAnalysisMutation.isPending && (
            <>
              {teamAnalysisMutation.isIdle && (
                <div className="text-sm text-secondary-wh40k mb-4">
                  Click &quot;Run Analysis&quot; to search for battles using
                  this team.
                </div>
              )}
              {!teamAnalysisMutation.isIdle && !hasData && (
                <div className="text-sm text-(--text-tertiary) mb-4">
                  No matching battles found for this exact team composition.
                </div>
              )}
              {!teamAnalysisMutation.isIdle && hasData && analysisData && (
                <>
                  <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-secondary-wh40k">Team</span>
                      <UnitRow units={selectedUnits} size="sm" />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <div className="text-xs text-(--text-tertiary)">
                          Used
                        </div>
                        <div className="text-lg font-semibold text-primary-wh40k">
                          {formatNumber(analysisData.totalUsed)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-(--text-tertiary)">
                          Win rate
                        </div>
                        <div className="text-lg font-semibold text-emerald-400">
                          {formatPercent(analysisData.winRate)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-(--text-tertiary)">
                          Record
                        </div>
                        <div className="text-lg font-semibold text-primary-wh40k">
                          {formatNumber(analysisData.wins)}-
                          {formatNumber(analysisData.losses)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Card className="border-(--border) bg-(--bg-secondary)">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Matchups</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-3 space-y-2 text-sm">
                        {analysisData.matchups.length > 0 ? (
                          analysisData.matchups.map((matchup) => (
                            <div
                              key={matchup.defenderTeam}
                              className="flex items-center justify-between"
                            >
                              <span>{matchup.defenderTeam}</span>
                              <span className="font-mono text-secondary-wh40k">
                                {formatPercent(matchup.winRate)}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-(--text-tertiary)">
                            Not enough data
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    <Card className="border-(--border) bg-(--bg-secondary)">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                          Zone Breakdown
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-3 space-y-2 text-sm">
                        {analysisData.zoneBreakdown.length > 0 ? (
                          analysisData.zoneBreakdown.map((zone) => (
                            <div
                              key={zone.zoneType}
                              className="flex items-center justify-between"
                            >
                              {/* The only formatting site for the raw `zone_type` (`zoneDisplayName` is not idempotent). */}
                              <span>{zoneDisplayName(zone.zoneType)}</span>
                              <span className="font-mono text-secondary-wh40k">
                                {formatPercent(zone.winRate)}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-(--text-tertiary)">
                            Not enough data
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="border-(--border) bg-(--bg-secondary)">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">
                        Debuff Breakdown
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                      {analysisData.debuffBreakdown.length > 0 ? (
                        analysisData.debuffBreakdown.map((buff) => (
                          <div
                            key={buff.debuffLevel}
                            className="flex items-center justify-between rounded-md border border-(--border) bg-(--bg-primary) p-3"
                          >
                            <span>{buff.debuffLevel}</span>
                            <span className="font-mono text-secondary-wh40k">
                              {formatPercent(buff.winRate)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-(--text-tertiary)">
                          Not enough data
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          disabled={!isReady || teamAnalysisMutation.isPending}
          onClick={handleRunAnalysis}
        >
          {teamAnalysisMutation.isPending ? 'Analyzing...' : 'Run Analysis'}
        </Button>
      </div>
    </div>
  )
}
