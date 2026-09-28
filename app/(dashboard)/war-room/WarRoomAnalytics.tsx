'use client'

import { useMemo } from 'react'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  type DataTableColumn
} from '@tacticus/ui-kit'
import type { HeroCatalog } from '@/app/lib/catalogs'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'
import type { HeroUsage } from './types'

interface UsageRow {
  unitId: string
  timesFielded: number
  timesDied: number
  usedBy: number
  playerNames: string[]
  isMow: boolean
}

function buildUsageRows(usage: HeroUsage[]): UsageRow[] {
  const byUnit = new Map<
    string,
    {
      timesFielded: number
      timesDied: number
      players: Set<string>
      playerNames: Set<string>
      isMow: boolean
    }
  >()

  for (const row of usage) {
    const unitId = row.unit_id?.trim()
    if (!unitId) continue

    const entry = byUnit.get(unitId) ?? {
      timesFielded: 0,
      timesDied: 0,
      players: new Set<string>(),
      playerNames: new Set<string>(),
      isMow: false
    }
    entry.timesFielded += row.times_fielded ?? 0
    entry.timesDied += row.times_died ?? 0
    entry.isMow ||= row.is_mow === true
    const playerKey = row.player_id || row.player_name
    if (playerKey) entry.players.add(playerKey)
    if (row.player_name?.trim()) entry.playerNames.add(row.player_name.trim())
    byUnit.set(unitId, entry)
  }

  return [...byUnit.entries()]
    .map(([unitId, entry]) => ({
      unitId,
      timesFielded: entry.timesFielded,
      timesDied: entry.timesDied,
      usedBy: entry.players.size,
      playerNames: [...entry.playerNames].sort(),
      isMow: entry.isMow
    }))
    .sort((a, b) => b.timesFielded - a.timesFielded)
}

export default function WarRoomAnalytics({
  usage,
  catalog
}: {
  usage: HeroUsage[]
  catalog: HeroCatalog | undefined
}) {
  const rows = useMemo(() => buildUsageRows(usage), [usage])

  const columns = useMemo<DataTableColumn<UsageRow>[]>(
    () => [
      {
        key: 'hero',
        header: 'Hero',
        sortable: false,
        render: (row) => {
          const portrait = resolveHeroPortrait(row.unitId, catalog)
          return (
            <span className="flex min-w-48 items-center gap-2">
              {portrait.portraitUrl ? (
                <img
                  src={portrait.portraitUrl}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover ring-1 ring-(--card-border)"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-(--bg-secondary) text-[9px] font-bold uppercase text-(--text-tertiary)">
                  {portrait.fallbackBadge}
                </span>
              )}
              <span className="font-medium text-primary-wh40k">
                {portrait.displayName}
              </span>
              {row.isMow ? <Badge variant="secondary">MoW</Badge> : null}
            </span>
          )
        }
      },
      {
        key: 'fielded',
        header: 'Fielded',
        sortable: false,
        align: 'right',
        render: (row) => row.timesFielded
      },
      {
        key: 'usedBy',
        header: 'Used by',
        sortable: false,
        align: 'right',
        render: (row) => (
          <span title={row.playerNames.join(', ')}>{row.usedBy}</span>
        )
      },
      {
        key: 'died',
        header: 'Died',
        sortable: false,
        align: 'right',
        render: (row) => (row.timesDied > 0 ? row.timesDied : '—')
      }
    ],
    [catalog]
  )

  return (
    <Card className="border-(--card-border) bg-(--bg-primary)">
      <CardHeader className="border-b border-(--card-border) pb-4">
        <CardTitle className="text-base">Hero usage this war</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState
            title="No hero usage recorded this war yet."
            className="py-10"
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.unitId}
            density="compact"
          />
        )}
      </CardContent>
    </Card>
  )
}

export { buildUsageRows }
