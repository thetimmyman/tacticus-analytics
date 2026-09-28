'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, Users } from 'lucide-react'
import { extractErrorMessage as extractErrorEnvelope } from '@/app/lib/utils/error-message'

// Optimistic self-service membership; the server enforces user_id == caller and source == 'self'.

// Keeps the local (body, status) signature over the canonical helper.
const extractErrorMessage = (body: unknown, status: number): string =>
  extractErrorEnvelope(body, `Request failed (${status})`)

interface MetaTeam {
  id: string
  team_name: string
  description: string | null
  sort_order: number | null
}

interface PlayerMetaRoleRow {
  id: string
  user_id: string
  meta_team_id: string
  source: string
  set_by: string | null
  created_at: string
  updated_at: string
}

interface MetaTeamMembershipProps {
  userId: string
  guildCode: string | null
}

export function MetaTeamMembership({
  userId,
  guildCode
}: MetaTeamMembershipProps) {
  const [teams, setTeams] = useState<MetaTeam[] | null>(null)
  const [myRoles, setMyRoles] = useState<PlayerMetaRoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null)

  const guildScopeAvailable = Boolean(guildCode)

  useEffect(() => {
    if (!guildScopeAvailable) {
      setLoading(false)
      return
    }
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const [teamsRes, rolesRes] = await Promise.all([
          fetch('/api/meta-teams'),
          fetch(
            `/api/player-meta-roles?guild_code=${encodeURIComponent(guildCode!)}`
          )
        ])
        const teamsBody = await teamsRes.json().catch(() => null)
        const rolesBody = await rolesRes.json().catch(() => null)
        if (cancelled) return
        if (!teamsRes.ok) {
          setError(extractErrorMessage(teamsBody, teamsRes.status))
          return
        }
        if (!rolesRes.ok) {
          setError(extractErrorMessage(rolesBody, rolesRes.status))
          return
        }
        const teamsList: MetaTeam[] = Array.isArray(teamsBody?.teams)
          ? teamsBody.teams
          : []
        const allRows: PlayerMetaRoleRow[] = Array.isArray(rolesBody?.rows)
          ? rolesBody.rows
          : []
        // The API returns the whole guild; keep the caller's rows.
        setTeams(teamsList)
        setMyRoles(allRows.filter((r) => r.user_id === userId))
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : 'Failed to load meta teams'
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [userId, guildCode, guildScopeAvailable])

  const myTeamIds = useMemo(
    () => new Set(myRoles.map((r) => r.meta_team_id)),
    [myRoles]
  )

  // Editable only when the source is 'self' or absent; leader_override/auto rows are display-only.
  const sourceForTeam = (teamId: string): string | null => {
    return myRoles.find((r) => r.meta_team_id === teamId)?.source ?? null
  }

  const toggle = async (team: MetaTeam) => {
    if (pendingTeamId !== null) return
    if (!guildCode) return
    const currentSource = sourceForTeam(team.id)
    if (
      currentSource === 'leader_override' ||
      currentSource === 'auto' ||
      currentSource === 'manual'
    ) {
      // Locked by a higher-precedence write: show a note instead of a silent no-op.
      setError(
        `Your "${team.team_name}" role is set by your guild leader. Ask them to change it.`
      )
      return
    }
    const isAdding = currentSource !== 'self'
    setPendingTeamId(team.id)
    setError(null)

    const prevRoles = myRoles
    if (isAdding) {
      setMyRoles((prev) => [
        ...prev,
        {
          id: `optimistic-${team.id}`,
          user_id: userId,
          meta_team_id: team.id,
          source: 'self',
          set_by: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
    } else {
      setMyRoles((prev) => prev.filter((r) => r.meta_team_id !== team.id))
    }

    try {
      let res: Response
      if (isAdding) {
        res = await fetch('/api/player-meta-roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            meta_team_id: team.id,
            source: 'self'
          })
        })
      } else {
        const params = new URLSearchParams({
          user_id: userId,
          meta_team_id: team.id,
          source: 'self'
        })
        res = await fetch(`/api/player-meta-roles?${params.toString()}`, {
          method: 'DELETE'
        })
      }
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setMyRoles(prevRoles)
        setError(extractErrorMessage(body, res.status))
        return
      }
      if (isAdding && body && body.row) {
        setMyRoles((prev) =>
          prev.map((r) =>
            r.id === `optimistic-${team.id}`
              ? (body.row as PlayerMetaRoleRow)
              : r
          )
        )
      }
    } catch (err) {
      setMyRoles(prevRoles)
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setPendingTeamId(null)
    }
  }

  if (!guildScopeAvailable) {
    return null // No guild → meta-team membership doesn't apply
  }

  return (
    <div className="card-wh40k p-6">
      <h2 className="text-lg font-semibold text-primary-wh40k mb-2 inline-flex items-center gap-2">
        <Users className="h-5 w-5" />
        Meta team membership
      </h2>
      <p className="text-sm text-secondary-wh40k mb-4">
        Pick the teams you run. Herald notifications will ping your Discord role
        for the bosses these teams are configured for. Roles assigned by your
        guild leader are shown locked — ask them to change those.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-secondary-wh40k">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-sm border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-300 mb-3">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {!loading && teams && teams.length === 0 && (
        <div className="text-xs italic text-secondary-wh40k">
          No meta teams configured yet for your cluster.
        </div>
      )}

      {!loading && teams && teams.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => {
            const source = sourceForTeam(team.id)
            const selected = myTeamIds.has(team.id)
            const locked = source !== null && source !== 'self'
            const isPending = pendingTeamId === team.id
            const lockBadge = locked
              ? source === 'leader_override'
                ? ' (set by leader)'
                : source === 'auto'
                  ? ' (auto-derived)'
                  : ' (locked)'
              : ''
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => toggle(team)}
                disabled={isPending || locked}
                className={
                  'rounded-sm border px-3 py-1.5 text-xs transition-colors ' +
                  (selected
                    ? 'border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent)'
                    : 'border-(--card-border) bg-(--bg-secondary) text-secondary-wh40k hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)]') +
                  (locked ? ' opacity-70 cursor-not-allowed' : '') +
                  (isPending ? ' opacity-50' : '')
                }
                title={team.description ?? team.team_name}
              >
                {isPending ? '…' : team.team_name}
                {lockBadge && (
                  <span className="ml-1 opacity-70 text-[10px]">
                    {lockBadge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
