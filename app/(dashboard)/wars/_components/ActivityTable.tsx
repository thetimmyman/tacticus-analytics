'use client'

import { useCallback } from 'react'
import { Badge } from '@tacticus/ui-kit'
import type { RecentAttempt, Unit } from '../_types'
import { countDefeatedUnits, formatNumber, UnitRow } from './war-shared'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { useHeroCatalog } from '@/app/lib/catalogs/heroes'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'
import ZoneImageTooltip from './ZoneImageTooltip'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

/** null = unknown (older syncs). */
const getScoreBadge = (
  score: number,
  isPerfect: boolean | null,
  isFailed: boolean
) => {
  if (isFailed || score === 0)
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/40">
        Failed
      </Badge>
    )
  if (isPerfect === true)
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/40">
        Perfect
      </Badge>
    )
  return (
    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40">
      Hit
    </Badge>
  )
}

const formatKillCount = (kills: number): string =>
  kills > 0 ? String(kills) : '—'

const formatAttemptTime = (time: string, hasMounted: boolean): string => {
  if (!hasMounted) return '—'
  // eslint-disable-next-line no-restricted-syntax
  return new Date(time).toLocaleString()
}

export default function ActivityTable({ rows }: { rows: RecentAttempt[] }) {
  const hasMounted = useHasMounted()
  const { data: catalog } = useHeroCatalog()

  const enrichUnits = useCallback(
    (units: Unit[]): Unit[] => {
      if (!catalog) return units
      return units.map((unit) => {
        const resolved = resolveHeroPortrait(unit.id, catalog)
        // On a catalog miss keep the API's defaults.
        if (!resolved.hero) return unit
        return {
          ...unit,
          name: resolved.displayName,
          portraitUrl: resolved.portraitUrl || unit.portraitUrl
        }
      })
    },
    [catalog]
  )

  const columns: DataTableColumn<RecentAttempt>[] = [
    {
      key: 'attacker',
      header: 'Attacker',
      sortable: false,
      render: (attempt) => (
        <div className="font-medium text-primary-wh40k">
          {attempt.attacker.name}
          <div className="text-xs text-(--text-tertiary)">
            {attempt.attacker.guildTag}
          </div>
        </div>
      )
    },
    {
      key: 'attackTeam',
      header: 'Attack Team',
      sortable: false,
      render: (attempt) => (
        // The fallback Skull uses text-current, which the td would dim.
        <div className="text-primary-wh40k">
          <UnitRow units={enrichUnits(attempt.attackerUnits)} size="sm" />
        </div>
      )
    },
    {
      key: 'defender',
      header: 'Defender',
      sortable: false,
      render: (attempt) => (
        <>
          {attempt.defender.name}
          <div className="text-xs text-(--text-tertiary)">
            {attempt.defender.guildTag}
          </div>
        </>
      )
    },
    {
      key: 'defenderTeam',
      header: 'Defender Team',
      sortable: false,
      render: (attempt) => (
        <div className="text-primary-wh40k">
          <UnitRow
            units={enrichUnits(attempt.defenderUnits)}
            size="sm"
            allDefeated={!attempt.isFailed}
          />
        </div>
      )
    },
    {
      key: 'zone',
      header: 'Zone',
      sortable: false,
      // The single formatting site for the raw zone_type.
      render: (attempt) => (
        <ZoneImageTooltip zoneType={attempt.zoneType}>
          <div>{zoneDisplayName(attempt.zoneType)}</div>
        </ZoneImageTooltip>
      )
    },
    {
      key: 'kills',
      header: 'Kills',
      sortable: false,
      align: 'center',
      render: (attempt) => formatKillCount(attempt.kills)
    },
    {
      key: 'deaths',
      header: 'Deaths',
      sortable: false,
      align: 'center',
      // Same HP evidence as UnitRow; '—' without attacker HP data, never fabricated.
      render: (attempt) => {
        const deaths = countDefeatedUnits(attempt.attackerUnits)
        return deaths === null ? '—' : String(deaths)
      }
    },
    {
      key: 'score',
      header: 'Score',
      sortable: false,
      align: 'center',
      render: (attempt) => (
        <div className="flex items-center justify-center gap-2">
          {getScoreBadge(attempt.score, attempt.isPerfect, attempt.isFailed)}
          <span className="font-mono text-secondary-wh40k">
            {formatNumber(attempt.score)}
          </span>
        </div>
      )
    },
    {
      key: 'buff',
      header: 'Buff',
      sortable: false,
      align: 'center',
      render: (attempt) => `Buff ${attempt.buffLevel}`
    },
    {
      key: 'time',
      header: 'Time',
      sortable: false,
      render: (attempt) => (
        <span className="text-(--text-tertiary)">
          {formatAttemptTime(attempt.time, hasMounted)}
        </span>
      )
    }
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(attempt) => attempt.id}
      empty={<span className="sr-only">No recent war attempts.</span>}
    />
  )
}
