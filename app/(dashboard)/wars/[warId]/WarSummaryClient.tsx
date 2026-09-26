'use client'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton
} from '@tacticus/ui-kit'
import {
  ScoreComparison,
  StatCard,
  formatNumber
} from '../_components/war-shared'
import { useWarInfo, useWarStats, useWarZones } from '../_hooks'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

const STAT_SKELETON_KEYS = [
  'attacks',
  'theirAttacks',
  'perfectHits',
  'winRate',
  'holdRate',
  'avgScore'
] as const

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {STAT_SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className="border border-[var(--border)] rounded-lg bg-[var(--bg-primary)] p-4"
        >
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  )
}

export default function WarSummaryClient({ warId }: { warId: string }) {
  const { data: war, isLoading: warLoading } = useWarInfo(warId)
  const { data: stats, isLoading: statsLoading } = useWarStats(warId)
  const {
    data: zones = [],
    isLoading: zonesLoading,
    error: zonesError
  } = useWarZones(warId)

  if (warLoading || statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <StatsSkeleton />
      </div>
    )
  }

  if (!war || !stats) {
    return (
      <div className="text-center py-8 text-[var(--text-secondary)]">
        Failed to load war data
      </div>
    )
  }

  // Keyed by zone TYPE: legacy `zoneName` conventions differ per sync.
  const zoneTally = zones.reduce<Record<string, number>>((acc, zone) => {
    acc[zone.zoneType] = (acc[zone.zoneType] ?? 0) + zone.offense.attacks
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <ScoreComparison
        leftLabel={war.guild.guildName}
        rightLabel={war.opponent.guildName}
        leftScore={war.guild.score}
        rightScore={war.opponent.score}
        caption="Official score (game-reported)"
        captionTitle="Game-reported war totals, including zone-capture bonuses (up to ~40K per capture)."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Our Attacks" value={formatNumber(stats.ourAttacks)} />
        <StatCard
          label="Their Attacks"
          value={formatNumber(stats.theirAttacks)}
        />
        <StatCard
          label="Perfect Hits"
          value={formatNumber(stats.perfectHits)}
          tone="text-green-400"
        />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate}%`}
          tone="text-emerald-400"
        />
        <StatCard
          label="Hold Rate"
          value={`${stats.holdRate}%`}
          tone="text-cyan-400"
        />
        <StatCard
          label="Avg Score"
          value={formatNumber(stats.avgScore)}
          hint="Per attack, from recorded battles"
          tooltip="Average score per attack, computed from recorded battles. Totals derived from recorded battles can differ from the game-reported total above (sync timing, score components not tied to individual battles)."
        />
      </div>

      <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
        <CardHeader className="pb-2">
          <CardTitle>Zone Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          {zonesLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : zonesError ? (
            <div className="text-center py-4 text-[var(--text-tertiary)]">
              Zone data unavailable
            </div>
          ) : Object.entries(zoneTally).length > 0 ? (
            Object.entries(zoneTally).map(([zoneType, count]) => (
              <div
                key={zoneType}
                className="flex items-center justify-between text-sm"
              >
                <div className="font-semibold text-[var(--text-primary)]">
                  {zoneDisplayName(zoneType)}
                </div>
                <div className="font-mono text-[var(--text-secondary)]">
                  {formatNumber(count)}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-[var(--text-tertiary)]">
              No zone data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
