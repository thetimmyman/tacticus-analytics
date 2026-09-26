'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Badge } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import {
  ArrowRight,
  Check,
  AlertTriangle,
  Plus,
  Minus,
  RefreshCw,
  Target
} from 'lucide-react'
import { zoneDisplayName } from '@/app/lib/war/war-naming'
import {
  LiveZoneAssignment,
  PlannedZoneAssignment,
  ZoneDifference,
  computeZoneDifferences
} from '../_hooks/useWarZoneData'

interface LiveVsPlannedComparisonProps {
  liveZones: LiveZoneAssignment[]
  plannedZones: PlannedZoneAssignment[]
  onApplyLiveToPlanned: (zoneId: string, players: string[]) => void
  onApplyAllLiveToPlanned: () => void
  canManage: boolean
}

export default function LiveVsPlannedComparison({
  liveZones,
  plannedZones,
  onApplyLiveToPlanned,
  onApplyAllLiveToPlanned,
  canManage
}: LiveVsPlannedComparisonProps) {
  const differences = useMemo(
    () => computeZoneDifferences(liveZones, plannedZones),
    [liveZones, plannedZones]
  )

  const stats = useMemo(() => {
    const matching = differences.filter((d) => d.status === 'match').length
    const different = differences.filter((d) => d.status === 'different').length
    const onlyLive = differences.filter((d) => d.status === 'only_live').length
    const onlyPlanned = differences.filter(
      (d) => d.status === 'only_planned'
    ).length
    return {
      matching,
      different,
      onlyLive,
      onlyPlanned,
      total: differences.length
    }
  }, [differences])

  const hasDifferences =
    stats.different > 0 || stats.onlyLive > 0 || stats.onlyPlanned > 0

  const getStatusIcon = (status: ZoneDifference['status']) => {
    switch (status) {
      case 'match':
        return <Check className="h-4 w-4 text-green-400" />
      case 'different':
        return <AlertTriangle className="h-4 w-4 text-yellow-400" />
      case 'only_live':
        return <Plus className="h-4 w-4 text-blue-400" />
      case 'only_planned':
        return <Minus className="h-4 w-4 text-orange-400" />
    }
  }

  const getStatusBadge = (status: ZoneDifference['status']) => {
    switch (status) {
      case 'match':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            Match
          </Badge>
        )
      case 'different':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            Different
          </Badge>
        )
      case 'only_live':
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            New in Game
          </Badge>
        )
      case 'only_planned':
        return (
          <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
            Only Planned
          </Badge>
        )
    }
  }

  if (liveZones.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-8 text-center">
          <Target className="h-8 w-8 sm:h-12 sm:w-12 text-[var(--text-secondary)] mx-auto mb-3 sm:mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-[var(--text-primary)] mb-2">
            No Live Zone Data
          </h3>
          <p className="text-[var(--text-secondary)] text-xs sm:text-sm">
            Sync from the game to see live zone assignments and compare with
            your plan.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Live vs Planned Comparison
            </CardTitle>
            {canManage && hasDifferences && (
              <Button size="sm" onClick={onApplyAllLiveToPlanned}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Apply All Live to Plan
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
            <div className="p-2 sm:p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
              <p className="text-lg sm:text-2xl font-bold text-green-400">
                {stats.matching}
              </p>
              <p className="text-[10px] sm:text-xs text-green-400/80">
                Matching
              </p>
            </div>
            <div className="p-2 sm:p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-center">
              <p className="text-lg sm:text-2xl font-bold text-yellow-400">
                {stats.different}
              </p>
              <p className="text-[10px] sm:text-xs text-yellow-400/80">
                Different
              </p>
            </div>
            <div className="p-2 sm:p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-center">
              <p className="text-lg sm:text-2xl font-bold text-blue-400">
                {stats.onlyLive}
              </p>
              <p className="text-[10px] sm:text-xs text-blue-400/80">
                New in Game
              </p>
            </div>
            <div className="p-2 sm:p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-center">
              <p className="text-lg sm:text-2xl font-bold text-orange-400">
                {stats.onlyPlanned}
              </p>
              <p className="text-[10px] sm:text-xs text-orange-400/80">
                Only Planned
              </p>
            </div>
          </div>

          {!hasDifferences ? (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
              <Check className="h-8 w-8 text-green-400 mx-auto mb-2" />
              <p className="text-green-400 font-medium">
                All zones match your plan!
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {differences
                .filter((d) => d.status !== 'match')
                .map((diff) => (
                  <div
                    key={diff.zoneId}
                    className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(diff.status)}
                        {/* Derived from the type; the stored `zoneName` follows the writing sync's convention. */}
                        <span className="font-medium text-[var(--text-primary)]">
                          {zoneDisplayName(diff.zoneType)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(diff.status)}
                        {canManage && diff.status !== 'only_planned' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              onApplyLiveToPlanned(
                                diff.zoneId,
                                diff.livePlayers
                              )
                            }
                            title="Apply live to plan"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-[var(--text-secondary)] mb-1 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                          Live (In Game)
                        </p>
                        <div className="space-y-1">
                          {diff.livePlayers.length > 0 ? (
                            diff.livePlayers.map((player) => (
                              <div
                                key={player}
                                className={`px-2 py-1 rounded text-xs ${
                                  diff.addedToLive.includes(player)
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                                }`}
                              >
                                {diff.addedToLive.includes(player) && (
                                  <Plus className="h-3 w-3 inline mr-1" />
                                )}
                                {player}
                              </div>
                            ))
                          ) : (
                            <span className="text-[var(--text-tertiary)] italic">
                              Empty
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-[var(--text-secondary)] mb-1 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                          Planned
                        </p>
                        <div className="space-y-1">
                          {diff.plannedPlayers.length > 0 ? (
                            diff.plannedPlayers.map((player) => (
                              <div
                                key={player}
                                className={`px-2 py-1 rounded text-xs ${
                                  diff.removedFromLive.includes(player)
                                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                                }`}
                              >
                                {diff.removedFromLive.includes(player) && (
                                  <Minus className="h-3 w-3 inline mr-1" />
                                )}
                                {player}
                              </div>
                            ))
                          ) : (
                            <span className="text-[var(--text-tertiary)] italic">
                              Not planned
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
