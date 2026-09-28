'use client'

import Link from 'next/link'
import { Button } from '@tacticus/ui-kit'
import type { PlayerMapping, UserRole } from '@tacticus/app-core/types'
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
  getPerformanceColor
} from './utils'
import {
  LeaderRoleOverrideCell,
  type MetaTeamOption,
  type PlayerMetaRoleRow
} from './LeaderRoleOverrideCell'
import { MemberActionsDropdown } from './MemberActionsDropdown'
import {
  renderApiKeyIndicator,
  getBossPreferences,
  getAvailabilityMissingReason
} from './member-list-shared'

interface MemberMobileCardsProps {
  members: ExtendedMember[]
  tokenData: Record<string, TokenUsageData>
  tokenDataError?: string | null
  bossPerformanceData: Record<string, BossPerformanceData[]>
  metaTeams: MetaTeam[]
  selectedSeason: string
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

export function MemberMobileCards({
  members,
  tokenData,
  tokenDataError = null,
  bossPerformanceData,
  metaTeams,
  selectedSeason,
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
}: MemberMobileCardsProps) {
  const avatarFrameMap = buildAvatarFrameMap(avatarFrames)

  const getAvatarUrl = (member: ExtendedMember): string =>
    resolvePlayerAvatar({
      avatarUnitId: member.avatar_unit_id,
      playerName: member.display_name || 'Unknown',
      guildCode,
      size: 40,
      frameMap: avatarFrameMap
    })
  if (members.length === 0) {
    return (
      <div className="lg:hidden px-6 py-10 text-center text-sm text-secondary-wh40k">
        No members match your current filters.
      </div>
    )
  }

  return (
    <div className="lg:hidden space-y-4">
      {members.map((member) => {
        const canEdit = canEditMember(member)
        const preferences = getBossPreferences(member)
        const memberPerformance =
          bossPerformanceData[member.display_name || ''] || []
        const usage = getTokenUsageSummary(member, tokenData)
        const bombStatus = getBombStatus(member, tokenData)

        return (
          <div key={member.player_id} className="card-wh40k p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="relative shrink-0">
                  <img
                    src={getAvatarUrl(member)}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = getUserAvatar(
                        member.display_name || 'Unknown',
                        guildCode,
                        40
                      )
                    }}
                  />
                  {member.player_level != null && (
                    <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-bold leading-none px-1 py-px rounded-full bg-black/85 border border-amber-500/50 text-amber-300 whitespace-nowrap pointer-events-none">
                      {member.player_level}
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium mb-1 flex items-center gap-2">
                    <Link
                      href={`/player-stats?player=${encodeURIComponent(member.display_name || '')}&guild=${encodeURIComponent(member.guild_code || '')}`}
                      className="text-primary-wh40k hover:text-(--accent) hover:underline transition-colors"
                    >
                      <MemberName
                        value={member.display_name}
                        fallback="Unknown"
                      />
                    </Link>
                    {renderApiKeyIndicator(member)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs text-(--bg-primary) ${getRoleBadgeColor((member.role as UserRole) || 'member')}`}
                    >
                      {getRoleDisplayName(
                        (member.role as UserRole) || 'member'
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="shrink-0 ml-3">
                {canEdit ? (
                  <MemberActionsDropdown
                    member={member}
                    onAction={(action) => onOpenAction(member, action)}
                    size="sm"
                    isAppAdmin={isAppAdmin}
                  />
                ) : canInviteMember && !member.user_id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-3 py-1 text-xs text-emerald-400"
                    onClick={() => onOpenAction(member, 'generateInviteCode')}
                  >
                    Invite
                  </Button>
                ) : (
                  <span className="text-xs text-(--text-tertiary)">
                    No edit access
                  </span>
                )}
              </div>
            </div>

            {selectedSeason && (
              <>
                <div className="border-t border-(--card-border) pt-3">
                  <h4 className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide mb-2">
                    Availability
                  </h4>
                  <div className="flex flex-col gap-1 text-xs">
                    {usage ? (
                      <div className="flex items-center justify-between">
                        <span className="text-secondary-wh40k">Tokens:</span>
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-primary-wh40k">
                            {usage.available ?? 0}
                            {usage.max !== null ? ` / ${usage.max}` : ''}{' '}
                            available
                          </span>
                          {usage.nextSeconds !== null &&
                          usage.nextSeconds !== undefined &&
                          usage.nextSeconds > 0 ? (
                            <span className="text-[10px] text-(--text-tertiary)">
                              Next in ~{Math.ceil(usage.nextSeconds / 3600)}h
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="text-secondary-wh40k">
                        {tokenDataError
                          ? `Availability unavailable - ${getAvailabilityMissingReason(member, tokenDataError)}`
                          : `No availability data - ${getAvailabilityMissingReason(member)}`}
                      </div>
                    )}
                    {bombStatus && (
                      <div className="flex items-center justify-between">
                        <span className="text-secondary-wh40k">Bomb:</span>
                        <div className="flex flex-col items-end">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                              bombStatus.available
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-card/40 text-secondary-wh40k border-card-border/40'
                            }`}
                          >
                            {bombStatus.available ? 'Ready' : 'Used'}
                          </span>
                          {bombStatus.nextSeconds !== null &&
                          bombStatus.nextSeconds !== undefined &&
                          bombStatus.nextSeconds > 0 ? (
                            <span className="text-[10px] text-(--text-tertiary)">
                              Next in ~
                              {Math.ceil(bombStatus.nextSeconds / 3600)}h
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-(--card-border) pt-3">
                  <h4 className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide mb-2">
                    Boss Assignments
                  </h4>
                  <div className="text-xs space-y-1">
                    {member.primary_boss ? (
                      <div className="text-primary-wh40k">
                        1°{' '}
                        {BOSS_DISPLAY_NAMES[member.primary_boss] ||
                          member.primary_boss}
                      </div>
                    ) : null}
                    {member.secondary_boss ? (
                      <div className="text-secondary-wh40k">
                        2°{' '}
                        {BOSS_DISPLAY_NAMES[member.secondary_boss] ||
                          member.secondary_boss}
                      </div>
                    ) : null}
                    {!member.primary_boss && !member.secondary_boss && (
                      <span className="text-secondary-wh40k">Not assigned</span>
                    )}
                  </div>
                </div>

                <div className="border-t border-(--card-border) pt-3">
                  <h4 className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide mb-2">
                    Preferences
                  </h4>

                  <div className="mb-3">
                    <div className="text-xs font-medium text-secondary-wh40k mb-1">
                      Boss Preferences:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {preferences.length > 0 ? (
                        preferences.map((pref) => (
                          <span
                            key={`${pref.boss}-${pref.preference}`}
                            className="inline-flex items-center text-xs"
                          >
                            {getPreferenceIcon(pref.preference)}
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
                  </div>

                  <div>
                    <div className="text-xs font-medium text-secondary-wh40k mb-1">
                      Meta Teams:
                    </div>
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
                          <span className="text-secondary-wh40k">
                            No preferences
                          </span>
                        )}
                    </div>
                  </div>
                </div>

                {memberPerformance.filter((perf) => perf.encounter_id === 0)
                  .length > 0 && (
                  <div className="border-t border-(--card-border) pt-3">
                    <h4 className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide mb-2">
                      Performance{' '}
                      {hasCluster ? 'vs Guild / Cluster' : 'vs Guild'}
                    </h4>
                    <div className="text-xs space-y-1">
                      {memberPerformance
                        .sort((a, b) => {
                          const aIsMythic = a.rarity === 'Mythic' ? 1 : 0
                          const bIsMythic = b.rarity === 'Mythic' ? 1 : 0
                          if (aIsMythic !== bIsMythic)
                            return bIsMythic - aIsMythic
                          return b.set_num - a.set_num
                        })
                        .slice(0, 4)
                        .map((perf) => (
                          <div
                            key={perf.display_key}
                            className="flex justify-between items-center gap-2"
                          >
                            <span className="text-secondary-wh40k truncate">
                              {perf.display_key}
                            </span>
                            <div className="flex space-x-2 shrink-0">
                              <span
                                className={getPerformanceColor(
                                  perf.player_vs_guild_avg
                                )}
                                title="vs Guild"
                              >
                                {formatPerformancePercent(
                                  perf.player_vs_guild_avg
                                )}
                              </span>
                              {hasCluster && (
                                <>
                                  <span className="text-secondary-wh40k">
                                    /
                                  </span>
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
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="border-t border-(--card-border) pt-3">
              <h4 className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide mb-2">
                Herald Roles
              </h4>
              <LeaderRoleOverrideCell
                targetUserId={member.user_id ?? null}
                targetDisplayName={member.display_name ?? null}
                metaTeamOptions={metaTeamOptions}
                rows={
                  member.user_id ? (metaRolesByUser[member.user_id] ?? []) : []
                }
                canEdit={canEditMetaRoles && Boolean(member.user_id)}
                onChange={(newRows) => {
                  if (!member.user_id || !onMetaRolesChange) return
                  onMetaRolesChange(member.user_id, newRows)
                }}
              />
            </div>

            {member.officer_notes && (
              <div className="border-t border-(--card-border) pt-3">
                <h4 className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide mb-2">
                  Officer Notes
                </h4>
                <p className="text-sm text-secondary-wh40k">
                  {member.officer_notes}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
