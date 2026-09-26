'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type { PlayerRole, PlayerMapping } from '@tacticus/app-core/types'
import { useMetaTeams } from '@/app/hooks/useMetaTeams'
import { useDebounce } from '@/app/hooks/useDebounce'
import { useToast } from '@/app/hooks/useToast'
import { useCanEditMember } from '@/app/hooks/useCanEditMember'
import dynamic from 'next/dynamic'
import {
  MemberFilters,
  MemberListTable,
  MemberActionModals,
  MemberAvailabilitySummary,
  useMemberData,
  resolveSelectedSeason,
  type ExtendedMember,
  type MemberActionType,
  type RoleFilter,
  type SortColumn,
  BOSS_DISPLAY_NAMES
} from './components'
import type { PlayerMetaRoleRow } from './components/LeaderRoleOverrideCell'
import type { AvatarFrame } from '@/app/lib/utils/avatar'

const PlayerActivityChart = dynamic(
  () =>
    import('./components/PlayerActivityChart').then((mod) => ({
      default: mod.PlayerActivityChart
    })),
  { ssr: false }
)

interface MemberManagementProps {
  initialMembers: ExtendedMember[]
  userRole: PlayerRole
  userGuildCode: string
  claimedProfiles: number
  initialVeteranCount?: number
  hasCluster?: boolean
  initialSeason?: string
  avatarFrames?: AvatarFrame[]
  userTimezone?: string
  isAppAdmin?: boolean
}

export default function MemberManagement({
  initialMembers,
  userRole,
  userGuildCode,
  claimedProfiles,
  initialVeteranCount = 0,
  hasCluster = true,
  initialSeason = '',
  avatarFrames = [],
  userTimezone,
  isAppAdmin = false
}: MemberManagementProps) {
  const { toast } = useToast()
  const [members, setMembers] = useState<ExtendedMember[]>(initialMembers)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [actionMember, setActionMember] = useState<ExtendedMember | null>(null)
  const [activeAction, setActiveAction] = useState<MemberActionType | null>(
    null
  )
  const [sortConfig, setSortConfig] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
  }>({
    column: 'player',
    direction: 'asc'
  })

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  // The nav writes ?season= only on change, so fall back to the server season ('' hides columns).
  const searchParams = useSearchParams()
  const selectedSeason = resolveSelectedSeason(
    searchParams.get('season'),
    initialSeason
  )

  const {
    tokenData,
    tokenDataError,
    refetchTokenData,
    bossPerformanceData,
    availableBosses
  } = useMemberData({
    userGuildCode,
    selectedSeason
  })

  const { metaTeams: metaTeamRecords, loading: metaTeamsLoading } =
    useMetaTeams()
  const metaTeams = useMemo(
    () =>
      metaTeamRecords.map(
        (team: { team_name: string; display_name?: string | null }) => ({
          team_name: team.team_name,
          display_name: team.display_name ?? team.team_name
        })
      ),
    [metaTeamRecords]
  )

  // One fetch for all player_meta_roles, sliced per row, avoids an N+1 of per-cell calls.
  const [metaRolesByUser, setMetaRolesByUser] = useState<
    Record<string, PlayerMetaRoleRow[]>
  >({})
  const metaTeamOptions = useMemo(
    () =>
      metaTeamRecords.map((t) => ({
        id: t.id,
        team_name: t.team_name,
        description: t.description ?? null
      })),
    [metaTeamRecords]
  )

  useEffect(() => {
    if (!userGuildCode) return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(
          `/api/player-meta-roles?guild_code=${encodeURIComponent(userGuildCode)}`
        )
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) return
        const rows: PlayerMetaRoleRow[] = Array.isArray(body?.rows)
          ? body.rows
          : []
        const grouped: Record<string, PlayerMetaRoleRow[]> = {}
        rows.forEach((r) => {
          if (!r.user_id) return
          const roles = grouped[r.user_id] ?? []
          roles.push(r)
          grouped[r.user_id] = roles
        })
        setMetaRolesByUser(grouped)
      } catch {
        // Soft-fail: cells show 'None' and single edits still work.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [userGuildCode])

  const handleMetaRolesChange = useCallback(
    (userId: string, newRows: PlayerMetaRoleRow[]) => {
      setMetaRolesByUser((prev) => ({ ...prev, [userId]: newRows }))
    },
    []
  )

  const canEditMetaRoles = userRole === 'officer' || userRole === 'leader'

  const roleOptions = useMemo(() => {
    const uniqueRoles = new Set<PlayerRole>()
    initialMembers.forEach((member) => {
      if (member.role) uniqueRoles.add(member.role)
    })
    return Array.from(uniqueRoles).sort()
  }, [initialMembers])

  const roleBreakdown = useMemo(() => {
    const map = new Map<PlayerRole, number>()
    members.forEach((member) => {
      if (member.role) {
        map.set(member.role, (map.get(member.role) ?? 0) + 1)
      }
    })
    return map
  }, [members])

  const roleSortOrder: Record<PlayerRole, number> = useMemo(
    () =>
      ({
        leader: 0,
        officer: 1,
        veteran: 2,
        member: 3
      }) as Record<string, number>,
    []
  )

  const getTokenScore = useCallback(
    (member: PlayerMapping) => {
      const data = tokenData[member.display_name || '']
      if (!data) return Number.NEGATIVE_INFINITY
      if (!data.max_possible) return 0
      return data.tokens_used / data.max_possible
    },
    [tokenData]
  )

  const getPerformanceScore = useCallback(
    (member: PlayerMapping) => {
      const perf = bossPerformanceData[member.display_name || '']?.[0]
      return perf ? perf.player_vs_guild_avg : Number.NEGATIVE_INFINITY
    },
    [bossPerformanceData]
  )

  const getAssignmentScore = useCallback((member: PlayerMapping) => {
    if (member.primary_boss) {
      return `1-${member.primary_boss}-${member.secondary_boss || ''}`
    }
    if (member.secondary_boss) {
      return `2-${member.secondary_boss}`
    }
    return ''
  }, [])

  const compareMembers = useCallback(
    (a: PlayerMapping, b: PlayerMapping, column: SortColumn) => {
      switch (column) {
        case 'player':
          return (a.display_name || '').localeCompare(
            b.display_name || '',
            undefined,
            { sensitivity: 'base' }
          )
        case 'role':
          return (
            (roleSortOrder[a.role ?? 'member'] ?? 99) -
            (roleSortOrder[b.role ?? 'member'] ?? 99)
          )
        case 'status':
          return (a.user_id ? 1 : 0) - (b.user_id ? 1 : 0)
        case 'token':
          return getTokenScore(a) - getTokenScore(b)
        case 'performance':
          return getPerformanceScore(a) - getPerformanceScore(b)
        case 'assignment':
          return getAssignmentScore(a).localeCompare(getAssignmentScore(b))
        case 'notes':
          return (a.officer_notes || '').localeCompare(
            b.officer_notes || '',
            undefined,
            { sensitivity: 'base' }
          )
        default:
          return 0
      }
    },
    [getAssignmentScore, getPerformanceScore, getTokenScore, roleSortOrder]
  )

  const filteredMembers = useMemo(() => {
    const normalizedTerm = debouncedSearchTerm.trim().toLowerCase()

    return members.filter((member) => {
      const matchesRole = roleFilter === 'all' || member.role === roleFilter
      if (!matchesRole) return false
      if (!normalizedTerm) return true

      const haystack = [
        member.display_name,
        member.discord_username ?? '',
        member.user_id ?? '',
        member.guild_code ?? '',
        member.role
      ]

      return haystack.some((value) =>
        value?.toLowerCase().includes(normalizedTerm)
      )
    })
  }, [members, roleFilter, debouncedSearchTerm])

  const sortedMembers = useMemo(() => {
    const sorted = [...filteredMembers]
    sorted.sort((a, b) => {
      const result = compareMembers(a, b, sortConfig.column)
      return sortConfig.direction === 'asc' ? result : -result
    })

    if (sortConfig.column === 'player') {
      sorted.sort((a, b) => {
        const roleDiff =
          (roleSortOrder[a.role ?? 'member'] ?? 99) -
          (roleSortOrder[b.role ?? 'member'] ?? 99)
        if (roleDiff !== 0)
          return sortConfig.direction === 'asc' ? roleDiff : -roleDiff
        const nameCompare = (a.display_name || '').localeCompare(
          b.display_name || '',
          undefined,
          { sensitivity: 'base' }
        )
        return sortConfig.direction === 'asc' ? nameCompare : -nameCompare
      })
    }

    return sorted
  }, [filteredMembers, sortConfig, compareMembers, roleSortOrder])

  const handleSort = useCallback((column: SortColumn) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { column, direction: 'asc' }
    })
  }, [])

  const openActionModal = useCallback(
    (member: ExtendedMember, action: MemberActionType) => {
      setActionMember(member)
      setActiveAction(action)
    },
    []
  )

  const closeActionModal = useCallback(() => {
    setActionMember(null)
    setActiveAction(null)
  }, [])

  const handleMemberUpdate = useCallback(
    (updatedMember: Partial<ExtendedMember> & { player_id: string }) => {
      setMembers((prev) =>
        prev.map((m) =>
          m.player_id === updatedMember.player_id
            ? { ...m, ...updatedMember }
            : m
        )
      )
      toast.success('Member updated', 'Changes saved successfully')
    },
    [toast]
  )

  const canEditMember = useCanEditMember(userRole)

  return (
    <div className="space-y-6">
      <MemberFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
        roleOptions={roleOptions}
        roleBreakdown={roleBreakdown}
        rosterCount={members.length}
        claimedProfiles={claimedProfiles}
        veteranCount={initialVeteranCount}
      />

      <PlayerActivityChart
        guildCode={userGuildCode}
        season={selectedSeason}
        members={members}
        metaTeams={metaTeams}
        availableBosses={availableBosses}
        userTimezone={userTimezone}
      />

      <div className="card-wh40k overflow-hidden">
        <MemberAvailabilitySummary
          members={members}
          tokenData={tokenData}
          tokenDataError={tokenDataError}
          onRetryTokenData={refetchTokenData}
          selectedSeason={selectedSeason}
        />

        <MemberListTable
          members={sortedMembers}
          tokenData={tokenData}
          tokenDataError={tokenDataError}
          bossPerformanceData={bossPerformanceData}
          metaTeams={metaTeams}
          selectedSeason={selectedSeason}
          sortConfig={sortConfig}
          onSort={handleSort}
          onOpenAction={openActionModal}
          canEditMember={canEditMember}
          canInviteMember={userRole === 'officer' || userRole === 'leader'}
          hasCluster={hasCluster}
          avatarFrames={avatarFrames}
          guildCode={userGuildCode}
          metaTeamOptions={metaTeamOptions}
          metaRolesByUser={metaRolesByUser}
          canEditMetaRoles={canEditMetaRoles}
          onMetaRolesChange={handleMetaRolesChange}
          isAppAdmin={isAppAdmin}
        />
      </div>

      <MemberActionModals
        actionMember={actionMember}
        activeAction={activeAction}
        onClose={closeActionModal}
        onMemberUpdate={handleMemberUpdate}
        availableBosses={availableBosses}
        metaTeams={metaTeams}
        metaTeamsLoading={metaTeamsLoading}
        bossDisplayNames={BOSS_DISPLAY_NAMES}
        metaTeamOptions={metaTeamOptions}
        metaRolesByUser={metaRolesByUser}
        canEditMetaRoles={canEditMetaRoles}
        onMetaRolesChange={handleMetaRolesChange}
      />

      <div className="card-wh40k p-4">
        <p className="text-sm text-[var(--text-secondary)]">
          {userRole === 'leader'
            ? 'Roles are synced automatically from the official API. Leaders can manage token assignments and officer notes here.'
            : 'Roles are synced automatically from the official API. Officers can manage token assignments and officer notes, but any role mismatches must be resolved via the guild API integration.'}
        </p>
      </div>
    </div>
  )
}
