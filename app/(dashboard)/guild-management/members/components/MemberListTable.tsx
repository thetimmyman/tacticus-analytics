'use client'

import Link from 'next/link'
import { Button } from '@tacticus/ui-kit'
import {
  RadixTooltip,
  RadixTooltipTrigger,
  RadixTooltipContent,
  RadixTooltipProvider
} from '@tacticus/ui-kit/radix-tooltip'
import type { PlayerMapping, UserRole } from '@tacticus/app-core/types'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import {
  getRoleDisplayName,
  getRoleBadgeColor
} from '@/app/lib/auth/permissions'
import {
  buildAvatarFrameMap,
  getUserAvatar,
  resolvePlayerAvatar,
  type AvatarFrame
} from '@/app/lib/utils/avatar'
import type {
  ExtendedMember,
  MemberActionType,
  SortColumn,
  TokenUsageData,
  BossPerformanceData,
  MetaTeam
} from './types'
import { MemberName } from '@/app/components/ui/MemberName'
import { BOSS_DISPLAY_NAMES } from './types'
import {
  getTokenUsageSummary,
  getBombStatus,
  getPreferenceIcon,
  formatPerformancePercent,
  getPerformanceColor,
  formatRelativeTime
} from './utils'
import type {
  MetaTeamOption,
  PlayerMetaRoleRow
} from './LeaderRoleOverrideCell'
import { MemberActionsDropdown } from './MemberActionsDropdown'
import { MemberMobileCards } from './MemberMobileCards'
import {
  renderApiKeyIndicator,
  getBossPreferences,
  getAvailabilityMissingReason
} from './member-list-shared'

// Synthetic keys for non-sortable columns; isSortColumn() keeps them from reaching `onSort`.
type MemberColumnKey =
  SortColumn | 'bossPreferences' | 'metaTeamPreferences' | 'actions'

const SORTABLE_MEMBER_COLUMNS: SortColumn[] = [
  'player',
  'token',
  'performance',
  'notes'
]

function isSortColumn(key: MemberColumnKey): key is SortColumn {
  return (SORTABLE_MEMBER_COLUMNS as string[]).includes(key)
}

interface MemberListTableProps {
  members: ExtendedMember[]
  tokenData: Record<string, TokenUsageData>
  tokenDataError?: string | null
  bossPerformanceData: Record<string, BossPerformanceData[]>
  metaTeams: MetaTeam[]
  selectedSeason: string
  sortConfig: { column: SortColumn; direction: 'asc' | 'desc' }
  onSort: (column: SortColumn) => void
  onOpenAction: (member: ExtendedMember, action: MemberActionType) => void
  canEditMember: (member: PlayerMapping) => boolean
  canInviteMember?: boolean
  hasCluster?: boolean
  avatarFrames?: AvatarFrame[]
  guildCode?: string
  metaTeamOptions?: MetaTeamOption[]
  metaRolesByUser?: Record<string, PlayerMetaRoleRow[]>
  canEditMetaRoles?: boolean
  onMetaRolesChange?: (userId: string, newRows: PlayerMetaRoleRow[]) => void
  isAppAdmin?: boolean
}

interface MemberActivityTooltipProps {
  member: ExtendedMember
}

function MemberActivityTooltipContent({ member }: MemberActivityTooltipProps) {
  return (
    <div className="space-y-1.5 min-w-[180px]">
      <div className="text-xs font-medium text-primary-wh40k border-b border-(--card-border) pb-1 mb-1.5">
        Player Info
      </div>
      {member.player_level != null && (
        <div className="flex justify-between text-xs">
          <span className="text-secondary-wh40k">Level:</span>
          <span className="text-amber-300 font-medium">
            {member.player_level}
          </span>
        </div>
      )}
      <div className="border-t border-(--card-border) pt-1.5 mt-1 space-y-1.5">
        <div className="text-xs font-medium text-secondary-wh40k">Activity</div>
        <div className="flex justify-between text-xs">
          <span className="text-secondary-wh40k">Last Login:</span>
          <span className="text-primary-wh40k">
            {formatRelativeTime(member.last_login_at)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-secondary-wh40k">Last Battle:</span>
          <span className="text-primary-wh40k">
            {formatRelativeTime(member.last_battle_time)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-secondary-wh40k">Last Bomb:</span>
          <span className="text-primary-wh40k">
            {formatRelativeTime(member.last_bomb_time)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function MemberListTable({
  members,
  tokenData,
  tokenDataError = null,
  bossPerformanceData,
  metaTeams,
  selectedSeason,
  sortConfig,
  onSort,
  onOpenAction,
  canEditMember,
  canInviteMember = false,
  hasCluster = true,
  avatarFrames = [],
  guildCode = '',
  metaTeamOptions = [],
  metaRolesByUser = {},
  canEditMetaRoles = false,
  onMetaRolesChange,
  isAppAdmin = false
}: MemberListTableProps) {
  const avatarFrameMap = buildAvatarFrameMap(avatarFrames)

  const getAvatarUrl = (member: ExtendedMember): string =>
    resolvePlayerAvatar({
      avatarUnitId: member.avatar_unit_id,
      playerName: member.display_name || 'Unknown',
      guildCode,
      size: 32,
      frameMap: avatarFrameMap
    })
  const columns: DataTableColumn<ExtendedMember, MemberColumnKey>[] = [
    {
      key: 'player',
      header: 'Player',
      className: 'whitespace-nowrap',
      render: (member) => (
        <RadixTooltip>
          <RadixTooltipTrigger asChild>
            <div className="flex items-center gap-3 cursor-default">
              <div className="relative shrink-0">
                <img
                  src={getAvatarUrl(member)}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = getUserAvatar(
                      member.display_name || 'Unknown',
                      guildCode,
                      32
                    )
                  }}
                />
                {member.player_level != null && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-bold leading-none px-1 py-px rounded-full bg-black/85 border border-amber-500/50 text-amber-300 whitespace-nowrap pointer-events-none">
                    {member.player_level}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Link
                    href={`/player-stats?player=${encodeURIComponent(member.display_name || '')}&guild=${encodeURIComponent(member.guild_code || '')}`}
                    className="text-primary-wh40k hover:text-(--accent) hover:underline transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MemberName
                      value={member.display_name}
                      fallback="Unknown"
                    />
                  </Link>
                  {renderApiKeyIndicator(member)}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-(--bg-primary) ${getRoleBadgeColor((member.role as UserRole) || 'member')}`}
                  >
                    {getRoleDisplayName((member.role as UserRole) || 'member')}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-secondary-wh40k border ${
                      member.user_id
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-card-border/40 bg-gray-500/10 text-primary-wh40k'
                    }`}
                  >
                    {member.user_id ? 'Claimed' : 'Unclaimed'}
                  </span>
                </div>
              </div>
            </div>
          </RadixTooltipTrigger>
          <RadixTooltipContent side="right" sideOffset={8}>
            <MemberActivityTooltipContent member={member} />
          </RadixTooltipContent>
        </RadixTooltip>
      )
    },
    ...(selectedSeason
      ? ([
          {
            key: 'token',
            header: 'Token / Bomb Availability',
            align: 'center',
            className: 'whitespace-nowrap',
            render: (member) => (
              <div className="text-xs flex flex-col gap-1 items-center">
                {(() => {
                  const usage = getTokenUsageSummary(member, tokenData)
                  if (!usage) {
                    if (tokenDataError) {
                      return (
                        <div className="text-amber-200 flex flex-col gap-0.5">
                          <span>Availability unavailable</span>
                          <span>
                            {getAvailabilityMissingReason(
                              member,
                              tokenDataError
                            )}
                          </span>
                        </div>
                      )
                    }
                    return (
                      <div className="text-secondary-wh40k flex flex-col gap-0.5">
                        <span>No availability data</span>
                        <span>{getAvailabilityMissingReason(member)}</span>
                      </div>
                    )
                  }
                  return (
                    <span className="font-mono text-primary-wh40k">
                      {usage.available ?? 0}
                      {usage.max !== null ? ` / ${usage.max}` : ''} available
                    </span>
                  )
                })()}
                {(() => {
                  const bombStatus = getBombStatus(member, tokenData)
                  if (!bombStatus) return null
                  return (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                        bombStatus.available
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-card/40 text-secondary-wh40k border-card-border/40'
                      }`}
                    >
                      {bombStatus.available ? 'Bomb Ready' : 'Bomb Used'}
                    </span>
                  )
                })()}
              </div>
            )
          },
          {
            key: 'bossPreferences',
            header: 'Boss Preferences',
            sortable: false,
            className: 'whitespace-nowrap',
            render: (member) => {
              const preferences = getBossPreferences(member)
              return (
                <div className="flex flex-wrap gap-1">
                  {preferences.length > 0 ? (
                    preferences.map((pref) => (
                      <span
                        key={`${pref.boss}-${pref.preference}`}
                        className="inline-flex items-center text-xs"
                      >
                        {/* DataTable's <td> forces text-secondary; set primary explicitly. */}
                        <span className="text-primary-wh40k">
                          {getPreferenceIcon(pref.preference)}
                        </span>
                        <span className="ml-1 text-secondary-wh40k">
                          {BOSS_DISPLAY_NAMES[pref.boss] || pref.boss}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-secondary-wh40k">
                      No preferences
                    </span>
                  )}
                </div>
              )
            }
          },
          {
            key: 'metaTeamPreferences',
            header: 'Meta Team Preferences',
            sortable: false,
            className: 'whitespace-nowrap',
            render: (member) => (
              <div className="text-xs space-y-1">
                {member.primary_team && (
                  <div className="flex items-center">
                    <span className="text-emerald-400 mr-1">1°</span>
                    <span className="text-primary-wh40k">
                      {metaTeams.find(
                        (t) => t.team_name === member.primary_team
                      )?.display_name || member.primary_team}
                    </span>
                  </div>
                )}
                {member.secondary_team && (
                  <div className="flex items-center">
                    <span className="text-blue-400 mr-1">2°</span>
                    <span className="text-secondary-wh40k">
                      {metaTeams.find(
                        (t) => t.team_name === member.secondary_team
                      )?.display_name || member.secondary_team}
                    </span>
                  </div>
                )}
                {member.tertiary_team && (
                  <div className="flex items-center">
                    <span className="text-orange-400 mr-1">3°</span>
                    <span className="text-secondary-wh40k">
                      {metaTeams.find(
                        (t) => t.team_name === member.tertiary_team
                      )?.display_name || member.tertiary_team}
                    </span>
                  </div>
                )}
                {!member.primary_team &&
                  !member.secondary_team &&
                  !member.tertiary_team && (
                    <span className="text-secondary-wh40k">No preferences</span>
                  )}
              </div>
            )
          },
          {
            key: 'performance',
            header: `Boss Performance ${hasCluster ? '(Guild / Cluster)' : '(vs Guild)'}`,
            render: (member) => {
              const memberPerformance =
                bossPerformanceData[member.display_name || ''] || []
              return (
                <div className="text-xs space-y-1">
                  {memberPerformance
                    .sort((a, b) => {
                      const aIsMythic = a.rarity === 'Mythic' ? 1 : 0
                      const bIsMythic = b.rarity === 'Mythic' ? 1 : 0
                      if (aIsMythic !== bIsMythic) return bIsMythic - aIsMythic
                      return b.set_num - a.set_num
                    })
                    .slice(0, 4)
                    .map((perf) => (
                      <div
                        key={perf.display_key}
                        className="flex justify-between gap-2"
                      >
                        <span
                          className="text-secondary-wh40k truncate max-w-[100px]"
                          title={perf.display_key}
                        >
                          {perf.display_key}
                        </span>
                        <div className="flex space-x-2 shrink-0">
                          <span
                            className={getPerformanceColor(
                              perf.player_vs_guild_avg
                            )}
                            title="vs Guild"
                          >
                            {formatPerformancePercent(perf.player_vs_guild_avg)}
                          </span>
                          {hasCluster && (
                            <>
                              <span className="text-secondary-wh40k">/</span>
                              <span
                                className={getPerformanceColor(
                                  perf.player_vs_cluster_avg
                                )}
                                title="vs Cluster"
                              >
                                {formatPerformancePercent(
                                  perf.player_vs_cluster_avg
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  {memberPerformance.length === 0 && (
                    <span className="text-secondary-wh40k">No data</span>
                  )}
                </div>
              )
            }
          }
        ] satisfies DataTableColumn<ExtendedMember, MemberColumnKey>[])
      : []),
    {
      key: 'notes',
      header: 'Officer Notes',
      render: (member) => (
        <p className="text-sm text-secondary-wh40k max-w-xs truncate">
          {member.officer_notes || '-'}
        </p>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      className: 'whitespace-nowrap',
      render: (member) => {
        const canEdit = canEditMember(member)
        return canEdit ? (
          <MemberActionsDropdown
            member={member}
            onAction={(action) => onOpenAction(member, action)}
            isAppAdmin={isAppAdmin}
          />
        ) : canInviteMember && !member.user_id ? (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full px-4 text-emerald-400"
            onClick={() => onOpenAction(member, 'generateInviteCode')}
          >
            Invite
          </Button>
        ) : (
          <span className="text-xs text-(--text-tertiary)">No edit access</span>
        )
      }
    }
  ]

  return (
    <RadixTooltipProvider delayDuration={400}>
      <div className="hidden lg:block">
        <DataTable
          rows={members}
          columns={columns}
          rowKey={(member) => member.player_id}
          sort={{ key: sortConfig.column, direction: sortConfig.direction }}
          onSortChange={(next) => {
            if (isSortColumn(next.key)) onSort(next.key)
          }}
          externallySorted
          empty={
            <div className="px-6 py-10 text-center text-sm text-secondary-wh40k">
              No members match your current filters.
            </div>
          }
        />
      </div>

      <MemberMobileCards
        members={members}
        tokenData={tokenData}
        tokenDataError={tokenDataError}
        bossPerformanceData={bossPerformanceData}
        metaTeams={metaTeams}
        selectedSeason={selectedSeason}
        onOpenAction={onOpenAction}
        canEditMember={canEditMember}
        canInviteMember={canInviteMember}
        hasCluster={hasCluster}
        avatarFrames={avatarFrames}
        guildCode={guildCode}
        metaTeamOptions={metaTeamOptions}
        metaRolesByUser={metaRolesByUser}
        canEditMetaRoles={canEditMetaRoles}
        onMetaRolesChange={onMetaRolesChange}
        isAppAdmin={isAppAdmin}
      />
    </RadixTooltipProvider>
  )
}
