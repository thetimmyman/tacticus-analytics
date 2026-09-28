'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  TabSelector
} from '@tacticus/ui-kit'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { usePlayerRoster } from '@/app/lib/hooks/shared'
import { RankIcon } from '@/app/(dashboard)/roster/components/RankIcon'
import { useWarRoom } from './hooks/useWarRoom'
import MetaTeamTable from './MetaTeamTable'
import TeamFormDialog from './TeamFormDialog'
import WarRoomAnalytics from './WarRoomAnalytics'
import { warRoomCatalog } from './catalog'
import { buildRosterIndex, findRosterHero } from './roster-match'
import type { MetaTeam, TeamPayload, TeamReadiness, WarSide } from './types'

interface WarRoomClientProps {
  canEdit: boolean
}

type View = 'teams' | 'analytics'

const RANK_NAMES: Record<number, string> = {
  0: 'Stone I',
  1: 'Stone II',
  2: 'Stone III',
  3: 'Iron I',
  4: 'Iron II',
  5: 'Iron III',
  6: 'Bronze I',
  7: 'Bronze II',
  8: 'Bronze III',
  9: 'Silver I',
  10: 'Silver II',
  11: 'Silver III',
  12: 'Gold I',
  13: 'Gold II',
  14: 'Gold III',
  15: 'Diamond I',
  16: 'Diamond II',
  17: 'Diamond III',
  18: 'Adamantium I',
  19: 'Adamantium II',
  20: 'Adamantium III',
  21: 'Mythic I',
  22: 'Mythic II',
  23: 'Mythic III'
}

async function responseError(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string | { message?: string }
      message?: string
    }
    if (typeof payload.error === 'string') return payload.error
    if (payload.error?.message) return payload.error.message
    if (payload.message) return payload.message
  } catch {
    // The status-specific fallback below is the useful message.
  }
  return fallback
}

export default function WarRoomClient({ canEdit }: WarRoomClientProps) {
  // null = the caller's own guild; the API resolves it from the session.
  const [selectedGuild, setSelectedGuild] = useState<string | null>(null)
  const { data, isLoading, error, refetch } = useWarRoom(9, selectedGuild)
  const { data: baseCatalog } = useHeroCatalog()
  const catalog = useMemo(() => warRoomCatalog(baseCatalog), [baseCatalog])
  const roster = usePlayerRoster()
  const queryClient = useQueryClient()
  const [side, setSide] = useState<WarSide>('offense')
  const [view, setView] = useState<View>('teams')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<MetaTeam | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const readinessById = useMemo(() => {
    const map = new Map<string, TeamReadiness>()
    for (const readiness of data?.readiness ?? []) {
      map.set(readiness.team_id, readiness)
    }
    return map
  }, [data?.readiness])

  const usedByUnit = useMemo(() => {
    const map = new Map<string, number>()
    for (const usage of data?.myUsage ?? []) {
      map.set(
        usage.unit_id,
        (map.get(usage.unit_id) ?? 0) + usage.times_fielded
      )
    }
    return map
  }, [data?.myUsage])

  const teamsBySide = useMemo(() => {
    const teams = data?.teams ?? []
    return {
      offense: teams.filter((team) => team.side === 'offense'),
      defense: teams.filter((team) => team.side === 'defense')
    }
  }, [data?.teams])

  const rosterByAlias = useMemo(
    () => buildRosterIndex([...roster.heroes, ...roster.machinesOfWar]),
    [roster.heroes, roster.machinesOfWar]
  )

  // Other guilds' teams are read-only: no edits, readiness or war usage.
  const isOwnGuild = data?.isOwnGuild ?? selectedGuild === null
  const canEditShown = canEdit && isOwnGuild
  const minRankName =
    data && isOwnGuild ? RANK_NAMES[data.minRankIndex] : undefined
  const guildOptions = data?.guilds ?? []
  const activeGuildCode = data?.guildCode ?? selectedGuild ?? ''
  const activeView: View = isOwnGuild ? view : 'teams'

  function selectGuild(guildCode: string) {
    setSelectedGuild(guildCode === data?.ownGuildCode ? null : guildCode)
    setDeleteError(null)
  }

  function getRosterHero(unitId: string) {
    return findRosterHero(unitId, catalog, rosterByAlias)
  }

  function openCreate() {
    setEditingTeam(null)
    setDialogOpen(true)
  }

  function openEdit(team: MetaTeam) {
    setEditingTeam(team)
    setDialogOpen(true)
  }

  async function saveTeam(payload: TeamPayload) {
    // TeamFormDialog renders rejected onSave errors; normalize transport failures.
    try {
      const method = editingTeam ? 'PATCH' : 'POST'
      const body = editingTeam ? { id: editingTeam.id, ...payload } : payload
      const response = await fetch('/api/guild-war/war-room', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error(await responseError(response, 'Failed to save team'))
      }

      await queryClient.invalidateQueries({
        queryKey: ['war-room']
      })
    } catch (error) {
      throw error instanceof Error ? error : new Error('Failed to save team')
    }
  }

  async function deleteTeam(team: MetaTeam) {
    if (!window.confirm(`Delete the "${team.name}" shared team?`)) return

    setDeleteError(null)
    try {
      const response = await fetch(
        `/api/guild-war/war-room?id=${encodeURIComponent(team.id)}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const message = await responseError(response, 'Failed to delete team')
        setDeleteError(message)
        return
      }

      await queryClient.invalidateQueries({
        queryKey: ['war-room']
      })
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete team'
      )
    }
  }

  const activeTeams = teamsBySide[side]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-primary-wh40k">War Room</h1>
            {data && isOwnGuild ? (
              <Badge
                variant="warning"
                title={`Battlefield minimum gear: ${minRankName ?? ''}`}
                className="gap-1"
              >
                Min <RankIcon rank={data.minRankIndex} size="sm" />
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-secondary-wh40k">
            {isOwnGuild
              ? 'Shared offense and defense lineups with your readiness and current-war hero usage'
              : 'Browsing a cluster guild\u2019s shared offense and defense lineups (read-only)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {guildOptions.length > 1 ? (
            <Select value={activeGuildCode} onValueChange={selectGuild}>
              <SelectTrigger className="w-56" aria-label="Guild">
                <SelectValue placeholder="Guild" />
              </SelectTrigger>
              <SelectContent>
                {guildOptions.map((guild) => (
                  <SelectItem key={guild.guildCode} value={guild.guildCode}>
                    {guild.guildCode === data?.ownGuildCode
                      ? `${guild.label} (your guild)`
                      : `${guild.label} (${guild.teamCount})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {canEditShown && activeView === 'teams' ? (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New team
            </Button>
          ) : null}
        </div>
      </div>

      {isOwnGuild ? (
        <TabSelector
          tabs={[
            { id: 'teams', label: 'Teams' },
            { id: 'analytics', label: 'Analytics' }
          ]}
          activeTab={view}
          onTabChange={(value) => setView(value as View)}
        />
      ) : null}

      {activeView === 'teams' ? (
        <TabSelector
          tabs={[
            {
              id: 'offense',
              label: `Offense (${teamsBySide.offense.length})`
            },
            { id: 'defense', label: `Defense (${teamsBySide.defense.length})` }
          ]}
          activeTab={side}
          onTabChange={(value) => setSide(value as WarSide)}
        />
      ) : null}

      {deleteError ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500"
        >
          {deleteError}
        </div>
      ) : null}

      {isLoading ? (
        <Card className="border-(--card-border) bg-(--bg-primary)">
          <CardContent className="flex justify-center py-16">
            <Spinner label="Loading War Room" />
          </CardContent>
        </Card>
      ) : null}

      {error && !isLoading ? (
        <Card className="border-(--card-border) bg-(--bg-primary)">
          <CardContent className="py-8">
            <EmptyState
              title="Failed to load the War Room"
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  Retry
                </Button>
              }
            >
              {error instanceof Error ? error.message : 'Unknown error'}
            </EmptyState>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !error && activeView === 'teams' ? (
        <MetaTeamTable
          teams={activeTeams}
          readinessById={readinessById}
          usedByUnit={usedByUnit}
          catalog={catalog}
          canEdit={canEditShown}
          onEdit={openEdit}
          onDelete={(team) => void deleteTeam(team)}
          getHeroById={getRosterHero}
          readinessAvailable={isOwnGuild}
          rosterStatus={
            roster.isLoading ? 'loading' : roster.error ? 'error' : 'ready'
          }
          minRankIndex={isOwnGuild ? (data?.minRankIndex ?? null) : null}
        />
      ) : null}

      {!isLoading && !error && activeView === 'analytics' ? (
        <WarRoomAnalytics usage={data?.usage ?? []} catalog={catalog} />
      ) : null}

      {dialogOpen ? (
        <TeamFormDialog
          key={editingTeam?.id ?? 'new'}
          team={editingTeam}
          catalog={catalog}
          onOpenChange={setDialogOpen}
          onSave={saveTeam}
        />
      ) : null}
    </div>
  )
}
