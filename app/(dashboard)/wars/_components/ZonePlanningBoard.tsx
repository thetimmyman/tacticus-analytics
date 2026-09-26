'use client'

import { Dispatch, DragEvent, SetStateAction } from 'react'
import { Badge } from '@tacticus/ui-kit'
import { X, GripVertical, UserCheck } from 'lucide-react'
import { getUserAvatar } from '@/app/lib/utils/avatar'
import { zoneDisplayName } from '@/app/lib/war/war-naming'
import {
  GuildMember,
  RARITY_LABELS,
  WarZoneConfig,
  formatPower,
  getRarityColor,
  getZoneGradient,
  getZoneIcon
} from './zoneManagementShared'

interface ZonePlanningBoardProps {
  guildCode: string
  canManage: boolean
  groupedByRow: Record<number, WarZoneConfig[]>
  unassignedPlayers: GuildMember[]
  signedUpPlayerNames: Set<string>
  showOnlySignedUp: boolean
  setShowOnlySignedUp: Dispatch<SetStateAction<boolean>>
  draggedPlayer: string | null
  dragOverZone: string | null
  getAssignedPlayers: (zoneId: string) => string[]
  getPlayerLevel: (name: string) => number
  getPlayerAvatarUrl: (name: string) => string | undefined
  getAvatarUrlFromId: (avatarUnitId: string | undefined) => string | undefined
  handleDragStart: (e: DragEvent<HTMLDivElement>, playerName: string) => void
  handleDragEnd: () => void
  handleDragOver: (e: DragEvent<HTMLDivElement>, zoneId: string) => void
  handleDragLeave: () => void
  handleDrop: (e: DragEvent<HTMLDivElement>, zoneId: string) => void
  removePlayerFromZone: (zoneId: string, playerName: string) => void
}

export default function ZonePlanningBoard({
  guildCode,
  canManage,
  groupedByRow,
  unassignedPlayers,
  signedUpPlayerNames,
  showOnlySignedUp,
  setShowOnlySignedUp,
  draggedPlayer,
  dragOverZone,
  getAssignedPlayers,
  getPlayerLevel,
  getPlayerAvatarUrl,
  getAvatarUrlFromId,
  handleDragStart,
  handleDragEnd,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  removePlayerFromZone
}: ZonePlanningBoardProps) {
  return (
    <div className="flex flex-col-reverse md:flex-row gap-4">
      <div className="flex-1 space-y-3">
        <div className="flex items-center justify-center flex-wrap gap-2 md:gap-4 text-[10px] md:text-xs text-[var(--text-secondary)]">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded bg-gray-500/50 mr-1" /> Common
          </span>
          <span className="flex items-center">
            <span className="w-2 h-2 rounded bg-green-500/50 mr-1" /> Uncommon
          </span>
          <span className="flex items-center">
            <span className="w-2 h-2 rounded bg-blue-500/50 mr-1" /> Rare
          </span>
          <span className="flex items-center">
            <span className="w-2 h-2 rounded bg-purple-500/50 mr-1" /> Epic
          </span>
          <span className="flex items-center">
            <span className="w-2 h-2 rounded bg-orange-500/50 mr-1" /> Legendary
          </span>
        </div>

        {Object.entries(groupedByRow)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([rowIndex, rowZones]) => (
            <div
              key={rowIndex}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2"
            >
              {rowZones
                .sort((a, b) => a.column - b.column)
                .map((zone) => {
                  const assignedPlayers = getAssignedPlayers(zone.zoneId)
                  const combinedLevel = assignedPlayers.reduce(
                    (sum, p) => sum + getPlayerLevel(p),
                    0
                  )
                  const isFull = assignedPlayers.length === 2
                  const isDragOver = dragOverZone === zone.zoneId

                  return (
                    <div
                      key={zone.zoneId}
                      onDragOver={(e) => handleDragOver(e, zone.zoneId)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, zone.zoneId)}
                      className={`
                          relative rounded-lg border-2 transition-all
                          bg-gradient-to-br ${getZoneGradient(zone.baseRarity)}
                          ${
                            isDragOver
                              ? 'border-[var(--accent)] ring-2 ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] scale-[1.02]'
                              : isFull
                                ? 'border-green-500/50'
                                : 'border-card-border/10'
                          }
                        `}
                    >
                      <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div
                              className={`p-1.5 rounded ${getRarityColor(zone.baseRarity)}`}
                            >
                              {getZoneIcon(zone.visualId)}
                            </div>
                            <div>
                              {/* `zoneId` is the zone type here; never the stored per-sync `zoneName`. */}
                              <h3 className="font-semibold text-[var(--text-primary)] text-xs leading-tight">
                                {zoneDisplayName(zone.zoneId)}
                              </h3>
                              <p className="text-[10px] text-[var(--text-secondary)]">
                                {formatPower(zone.recommendedPower)} rec
                              </p>
                            </div>
                          </div>
                          <Badge
                            className={`text-[10px] px-1.5 py-0.5 ${getRarityColor(zone.baseRarity)}`}
                          >
                            {RARITY_LABELS[zone.baseRarity]}
                          </Badge>
                        </div>

                        <div className="space-y-1">
                          {[0, 1].map((slot) => {
                            const player = assignedPlayers[slot]
                            const level = player ? getPlayerLevel(player) : 0
                            const avatarUrl = player
                              ? getPlayerAvatarUrl(player)
                              : undefined

                            return (
                              <div
                                key={slot}
                                className={`flex items-center justify-between p-1.5 rounded text-xs ${
                                  player
                                    ? 'bg-card/40'
                                    : 'bg-card/20 border border-dashed border-card-border/20'
                                }`}
                              >
                                {player ? (
                                  <>
                                    <div className="flex items-center space-x-1.5 min-w-0">
                                      <img
                                        src={
                                          avatarUrl ||
                                          getUserAvatar(player, guildCode, 20)
                                        }
                                        alt=""
                                        className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                                        onError={(e) => {
                                          e.currentTarget.src = getUserAvatar(
                                            player,
                                            guildCode,
                                            20
                                          )
                                        }}
                                      />
                                      <span className="text-[var(--text-primary)] truncate font-medium text-[11px]">
                                        {player}
                                      </span>
                                    </div>
                                    <div className="flex items-center space-x-1 flex-shrink-0">
                                      {level > 0 && (
                                        <span className="text-[var(--text-secondary)] text-[10px]">
                                          Lv.{level}
                                        </span>
                                      )}
                                      {canManage && (
                                        <button
                                          onClick={() =>
                                            removePlayerFromZone(
                                              zone.zoneId,
                                              player
                                            )
                                          }
                                          className="p-0.5 hover:bg-red-500/20 rounded"
                                        >
                                          <X className="h-3 w-3 text-red-400" />
                                        </button>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-[var(--text-secondary)] italic text-[10px]">
                                    Drop player here
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {assignedPlayers.length > 0 && combinedLevel > 0 && (
                          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-card-border/10">
                            <span className="text-[var(--text-secondary)]">
                              Avg Level:
                            </span>
                            <span className="font-bold text-[var(--text-primary)]">
                              {Math.round(
                                combinedLevel / assignedPlayers.length
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
      </div>

      <div className="w-full md:w-64 flex-shrink-0">
        <div className="md:sticky md:top-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] overflow-hidden">
          <div className="p-2 md:p-3 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--text-primary)] text-xs md:text-sm">
                Available Players ({unassignedPlayers.length})
              </h3>
              {signedUpPlayerNames.size > 0 && (
                <button
                  onClick={() => setShowOnlySignedUp((prev) => !prev)}
                  title={
                    showOnlySignedUp
                      ? 'Showing signed-up only — click to show all'
                      : 'Showing all — click to filter to signed-up'
                  }
                  className={`p-1 rounded transition-colors ${
                    showOnlySignedUp
                      ? 'text-green-400 bg-green-500/20'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'
                  }`}
                >
                  <UserCheck className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[200px] md:max-h-[600px] overflow-y-auto">
            {unassignedPlayers.length === 0 ? (
              <div className="p-4 text-center text-[var(--text-secondary)] text-sm">
                All players assigned!
              </div>
            ) : (
              <div className="p-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-1 gap-1">
                {unassignedPlayers.map((member) => {
                  const isDragging = draggedPlayer === member.display_name

                  return (
                    <div
                      key={member.display_name}
                      draggable={canManage}
                      onDragStart={(e) =>
                        handleDragStart(e, member.display_name)
                      }
                      onDragEnd={handleDragEnd}
                      className={`
                          flex flex-col md:flex-row items-center md:space-x-2 p-1.5 md:p-2 rounded-lg transition-all
                          ${canManage ? 'cursor-grab active:cursor-grabbing hover:bg-[var(--bg-tertiary)]' : ''}
                          ${isDragging ? 'opacity-50 ring-2 ring-[var(--accent)]' : ''}
                          bg-[var(--bg-primary)] border border-[var(--border)]
                        `}
                    >
                      {canManage && (
                        <GripVertical className="h-4 w-4 text-[var(--text-secondary)] flex-shrink-0 hidden md:block" />
                      )}

                      <div className="relative">
                        <img
                          src={
                            getAvatarUrlFromId(member.avatar_unit_id) ||
                            getUserAvatar(member.display_name, guildCode, 40)
                          }
                          alt=""
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0 border-2 border-[var(--border)]"
                          onError={(e) => {
                            e.currentTarget.src = getUserAvatar(
                              member.display_name,
                              guildCode,
                              40
                            )
                          }}
                        />
                        {member.player_level && member.player_level > 0 && (
                          <div className="absolute -bottom-1 -right-1 bg-card/80 text-[var(--text-primary)] text-[8px] font-bold px-1 rounded-full min-w-[16px] text-center border border-[var(--border)]">
                            {member.player_level}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 text-center md:text-left mt-1 md:mt-0">
                        <p className="text-[10px] md:text-sm font-medium text-[var(--text-primary)] truncate">
                          {member.display_name}
                        </p>
                        {member.player_level && member.player_level > 0 && (
                          <div className="text-[9px] md:text-[10px] text-[var(--text-secondary)]">
                            Level {member.player_level}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
