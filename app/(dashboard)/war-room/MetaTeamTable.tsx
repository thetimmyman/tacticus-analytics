'use client'

import { useMemo } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  type DataTableColumn
} from '@tacticus/ui-kit'
import type { HeroCatalog } from '@/app/lib/catalogs'
import type { RosterHero } from '@/app/lib/hooks/shared/types'
import { RankIcon } from '@/app/(dashboard)/roster/components/RankIcon'
import HeroCard from './HeroCard'
import type { MetaTeam, MetaTeamHero, TeamReadiness, TeamStatus } from './types'

interface MetaTeamTableProps {
  teams: MetaTeam[]
  readinessById: Map<string, TeamReadiness>
  usedByUnit: Map<string, number>
  catalog: HeroCatalog | undefined
  canEdit: boolean
  onEdit: (team: MetaTeam) => void
  onDelete: (team: MetaTeam) => void
  getHeroById: (unitId: string) => RosterHero | undefined
  /** False for another guild's teams: readiness columns hide rather than default to "ready". */
  readinessAvailable?: boolean
  /** Lets cards say "unknown" vs "not owned". */
  rosterStatus: 'loading' | 'error' | 'ready'
  minRankIndex: number | null
}

const STATUS: Record<
  TeamStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  ready: { label: 'ready', variant: 'default' },
  used: { label: 'used', variant: 'secondary' },
  'not-ready': { label: 'not ready', variant: 'destructive' }
}

interface TeamRow {
  team: MetaTeam
  status: TeamStatus
  readiness: TeamReadiness | undefined
  missing: Set<string>
}

function statusOf(
  team: MetaTeam,
  readiness: TeamReadiness | undefined,
  usedByUnit: Map<string, number>
): TeamStatus {
  const cores = team.heroes.filter((hero) => hero.role === 'core')
  const allCoresUsed =
    cores.length > 0 &&
    cores.every((hero) => (usedByUnit.get(hero.unitId) ?? 0) > 0)

  if (allCoresUsed) return 'used'
  if (readiness && !readiness.ready) return 'not-ready'
  return 'ready'
}

function missingUnitIds(readiness: TeamReadiness | undefined): Set<string> {
  if (!readiness?.missing_units?.length) return new Set()
  return new Set(readiness.missing_units.map((unit) => unit.unitId))
}

export default function MetaTeamTable({
  teams,
  readinessById,
  usedByUnit,
  catalog,
  canEdit,
  onEdit,
  onDelete,
  getHeroById,
  readinessAvailable = true,
  rosterStatus,
  minRankIndex
}: MetaTeamTableProps) {
  const rows = useMemo<TeamRow[]>(() => {
    const statusOrder: Record<TeamStatus, number> = {
      ready: 0,
      'not-ready': 1,
      used: 2
    }

    return teams
      .map((team) => {
        const readiness = readinessById.get(team.id)
        return {
          team,
          status: statusOf(team, readiness, usedByUnit),
          readiness,
          missing: missingUnitIds(readiness)
        }
      })
      .sort((a, b) => {
        if (a.status !== b.status) {
          return statusOrder[a.status] - statusOrder[b.status]
        }
        const priorityA = a.team.priority ?? Number.MAX_SAFE_INTEGER
        const priorityB = b.team.priority ?? Number.MAX_SAFE_INTEGER
        if (priorityA !== priorityB) return priorityA - priorityB
        const floorA = a.readiness?.floor_rank_index ?? Number.MAX_SAFE_INTEGER
        const floorB = b.readiness?.floor_rank_index ?? Number.MAX_SAFE_INTEGER
        return floorA - floorB
      })
  }, [readinessById, teams, usedByUnit])

  const columns = useMemo<DataTableColumn<TeamRow>[]>(() => {
    const base: DataTableColumn<TeamRow>[] = [
      {
        key: 'team',
        header: 'Team',
        sortable: false,
        render: ({ team }) => (
          <div className="min-w-40">
            <div className="font-semibold text-[var(--text-primary)]">
              {team.name}
            </div>
            {team.notes ? (
              <div
                className="mt-0.5 max-w-sm truncate text-xs text-[var(--text-tertiary)]"
                title={team.notes}
              >
                {team.notes}
              </div>
            ) : null}
          </div>
        )
      },
      {
        key: 'priority',
        header: 'Priority',
        sortable: false,
        align: 'right',
        render: ({ team }) =>
          team.priority == null ? (
            <span className="text-[var(--text-tertiary)]">—</span>
          ) : (
            team.priority
          )
      },
      ...(readinessAvailable
        ? ([
            {
              key: 'status',
              header: 'Readiness',
              sortable: false,
              render: ({ status }) => (
                <Badge variant={STATUS[status].variant}>
                  {STATUS[status].label}
                </Badge>
              )
            },
            {
              key: 'floor',
              header: 'Gear floor',
              sortable: false,
              render: ({ readiness }) =>
                readiness?.floor_rank_index != null ? (
                  <span title={readiness.floor_rank_name ?? undefined}>
                    <RankIcon rank={readiness.floor_rank_index} size="sm" />
                  </span>
                ) : (
                  <span
                    aria-label="No team floor"
                    className="text-[var(--text-tertiary)]"
                  >
                    —
                  </span>
                )
            }
          ] satisfies DataTableColumn<TeamRow>[])
        : []),
      {
        key: 'heroes',
        header: 'Heroes',
        sortable: false,
        render: ({ team, missing }) => (
          <div className="flex min-w-48 flex-wrap items-start gap-1.5">
            {team.heroes.map((hero: MetaTeamHero) => (
              <HeroCard
                key={hero.unitId}
                unitId={hero.unitId}
                role={hero.role}
                catalog={catalog}
                usedCount={usedByUnit.get(hero.unitId) ?? 0}
                notReady={missing.has(hero.unitId)}
                rosterHero={getHeroById(hero.unitId)}
                rosterStatus={rosterStatus}
                floorRankIndex={minRankIndex}
              />
            ))}
          </div>
        )
      }
    ]

    if (!canEdit) return base

    return [
      ...base,
      {
        key: 'actions',
        header: 'Actions',
        sortable: false,
        align: 'right',
        render: ({ team }) => (
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => onEdit(team)}
              aria-label={`Edit ${team.name}`}
              title={`Edit ${team.name}`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-[var(--text-tertiary)] hover:text-red-500"
              onClick={() => onDelete(team)}
              aria-label={`Delete ${team.name}`}
              title={`Delete ${team.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )
      }
    ]
  }, [
    canEdit,
    catalog,
    getHeroById,
    minRankIndex,
    onDelete,
    onEdit,
    readinessAvailable,
    rosterStatus,
    usedByUnit
  ])

  return (
    <Card className="border-[var(--card-border)] bg-[var(--bg-primary)]">
      <CardHeader className="border-b border-[var(--card-border)] pb-4">
        <CardTitle className="text-base">
          Shared teams ({teams.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={({ team }) => team.id}
          density="compact"
          empty={<EmptyState title="No shared teams" className="py-10" />}
        />
      </CardContent>
    </Card>
  )
}
