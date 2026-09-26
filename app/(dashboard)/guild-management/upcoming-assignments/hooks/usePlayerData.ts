import { useEffect, useMemo } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { normalizeTokenAllocationRecord } from '@/app/lib/boss-assignments/target-ids'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.upcoming-assignments.hooks.usePlayerData'
)
import type {
  AssignmentRow,
  PlayerAssignment,
  PlayerTokenAllocations
} from '../types'
import type { AssignmentState, AssignmentActions } from './useAssignmentState'
import { parseBossPreferences } from '../utils/boss-helpers'
import { useBaseQuery, useGuildMembers } from '@/app/lib/hooks/shared'
import { SEASON_CONFIG_PENDING_BOSS_NAME } from '@/app/api/season-config/_write-helpers'

interface PlayerDataResult {
  players: PlayerAssignment[]
  tokenAllocations: PlayerTokenAllocations
  hasExistingAssignments: boolean
}

async function fetchAssignments(
  guildCode: string,
  seasonNumber: string
): Promise<AssignmentRow[]> {
  const supabase = dbClient()

  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from('upcoming_season_assignments')
    .select(
      'player_id, display_name, primary_boss, secondary_boss, token_allocations, uses_flexible_tokens'
    )
    .eq('guild_code', guildCode)
    .eq('season_number', seasonNumber)

  if (assignmentsError) {
    logger.error(
      { err: assignmentsError },
      'Supabase error fetching assignments:'
    )
    throw assignmentsError
  }

  return (assignmentRows ?? []) as AssignmentRow[]
}

export function usePlayerData(
  _state: AssignmentState,
  actions: AssignmentActions,
  guildCode: string,
  computeTargetSeason: () => string,
  mode: 'current',
  primaryTokenValue: number,
  secondaryTokenValue: number
) {
  const seasonNumber = computeTargetSeason()

  const membersQuery = useGuildMembers({
    guildCode,
    activeOnly: true,
    enabled: Boolean(guildCode)
  })

  const assignmentsQuery = useBaseQuery<AssignmentRow[]>({
    queryKey: ['player-assignments', guildCode, seasonNumber, mode],
    queryFn: () => fetchAssignments(guildCode, seasonNumber),
    enabled: Boolean(guildCode) && Boolean(seasonNumber),
    cacheDuration: 2 * 60 * 1000
  })

  const playerData = useMemo<PlayerDataResult | null>(() => {
    if (membersQuery.isLoading || assignmentsQuery.isLoading) return null

    const typedAssignments = assignmentsQuery.data ?? []
    const allocationsByPlayer = new Map<string, Record<string, number>>()

    if (typedAssignments.length > 0) {
      typedAssignments.forEach((assignment) => {
        if (!assignment.token_allocations) return

        const key = assignment.display_name || assignment.player_id
        if (!key) return

        allocationsByPlayer.set(
          key,
          normalizeTokenAllocationRecord(assignment.token_allocations)
        )
      })
      const allocationsMap = Object.fromEntries(allocationsByPlayer)
      logger.info(
        { allocationsMap: allocationsMap },
        'Loaded token allocations from DB'
      )
    }

    const assignmentMap = new Map<
      string,
      { primary_boss: string | null; secondary_boss: string | null }
    >()
    typedAssignments.forEach((assignment) => {
      if (assignment.display_name) {
        assignmentMap.set(assignment.display_name, {
          primary_boss: assignment.primary_boss,
          secondary_boss: assignment.secondary_boss
        })
      }
      if (assignment.player_id) {
        assignmentMap.set(assignment.player_id, {
          primary_boss: assignment.primary_boss,
          secondary_boss: assignment.secondary_boss
        })
      }
    })

    const allocationsMap: PlayerTokenAllocations =
      Object.fromEntries(allocationsByPlayer)

    const guildPlayers = [...membersQuery.members].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    )

    const playerList: PlayerAssignment[] = guildPlayers.map((player) => {
      const assignment =
        assignmentMap.get(player.displayName) ??
        assignmentMap.get(player.playerId)
      const fallbackPrimary =
        mode === 'current' ? (player.primaryBoss ?? null) : null
      const fallbackSecondary =
        mode === 'current' ? (player.secondaryBoss ?? null) : null
      const preferences = parseBossPreferences(player.bossPreferences ?? null)

      return {
        player_id: player.playerId,
        display_name: player.displayName,
        primary_boss: assignment?.primary_boss || fallbackPrimary || null,
        secondary_boss: assignment?.secondary_boss || fallbackSecondary || null,
        boss_preferences: preferences,
        is_active: player.isActive,
        avatar_unit_id: player.avatarUnitId ?? null
      }
    })

    return {
      players: playerList,
      tokenAllocations: allocationsMap,
      hasExistingAssignments: typedAssignments.length > 0
    }
  }, [
    assignmentsQuery.data,
    assignmentsQuery.isLoading,
    membersQuery.isLoading,
    membersQuery.members,
    mode
  ])

  useEffect(() => {
    if (!playerData) return

    actions.setPlayers(playerData.players)

    if (Object.keys(playerData.tokenAllocations).length > 0) {
      actions.setPlayerTokenAllocations(playerData.tokenAllocations)
    } else if (mode === 'current' && !playerData.hasExistingAssignments) {
      const defaultsByPlayer = new Map<string, Record<string, number>>()
      playerData.players.forEach((player) => {
        const tokensByBoss = new Map<string, number>()
        if (player.primary_boss) {
          tokensByBoss.set(player.primary_boss, primaryTokenValue)
        }
        if (player.secondary_boss) {
          tokensByBoss.set(
            player.secondary_boss,
            (tokensByBoss.get(player.secondary_boss) ?? 0) + secondaryTokenValue
          )
        }
        if (tokensByBoss.size > 0) {
          defaultsByPlayer.set(
            player.display_name,
            Object.fromEntries(tokensByBoss)
          )
        }
      })
      const defaultAllocations: PlayerTokenAllocations =
        Object.fromEntries(defaultsByPlayer)
      if (Object.keys(defaultAllocations).length > 0) {
        actions.setPlayerTokenAllocations(defaultAllocations)
      }
    }
  }, [playerData, actions, mode, primaryTokenValue, secondaryTokenValue])
}

export function useSavedAssignmentsLoader(
  state: AssignmentState,
  actions: AssignmentActions,
  guildCode: string,
  computeTargetSeason: () => string,
  mode: 'current'
) {
  useEffect(() => {
    const loadSavedAssignmentsData = async () => {
      const supabase = dbClient()
      try {
        const seasonNumber = computeTargetSeason()

        const [bossesResult, assignmentsResult] = await Promise.all([
          supabase
            .from('upcoming_season_bosses')
            .select('*')
            .eq('guild_code', guildCode)
            .eq('season_number', seasonNumber),
          supabase
            .from('upcoming_season_assignments')
            .select('*')
            .eq('guild_code', guildCode)
            .eq('season_number', seasonNumber)
        ])

        // Writers insert '__pending__' placeholder rows (with real sub_bosses), so guard on the name.
        const bossRows = bossesResult.data ?? []
        const hasBossDataFromDB = bossRows.some(
          (b) => b.boss_name !== SEASON_CONFIG_PENDING_BOSS_NAME
        )

        if (hasBossDataFromDB) {
          const bosses: Record<string, string> = {}
          const subBosses: Record<string, string> = {}
          const skipSettings: Record<string, boolean> = {}

          bossRows.forEach((b) => {
            if (b.boss_name !== SEASON_CONFIG_PENDING_BOSS_NAME) {
              bosses[b.level as keyof typeof bosses] = b.boss_name
            }

            if (b.sub_bosses) {
              const subBossData =
                typeof b.sub_bosses === 'string'
                  ? JSON.parse(b.sub_bosses)
                  : b.sub_bosses

              if (subBossData.sub1) {
                subBosses[`${b.level}_Sub1` as keyof typeof subBosses] =
                  subBossData.sub1
              }
              if (subBossData.sub2) {
                subBosses[`${b.level}_Sub2` as keyof typeof subBosses] =
                  subBossData.sub2
              }

              skipSettings[`${b.level}_Sub1`] = subBossData.sub1_skip === true
              skipSettings[`${b.level}_Sub2`] = subBossData.sub2_skip === true
            }
          })

          actions.setSelectedBosses(bosses)
          actions.setSelectedSubBosses(subBosses)
          actions.setSkippedPrimes(skipSettings)

          const hasSubBosses = Object.values(subBosses).some((sb) => sb !== '')
          if (hasSubBosses) {
            actions.setSubBossesLoadedFromDB(true)
          }
        }

        if (assignmentsResult.data && assignmentsResult.data.length > 0) {
          actions.setSaveMessage('Loaded from database')
          setTimeout(() => actions.setSaveMessage(''), 3000)
        } else if (!hasBossDataFromDB) {
          // localStorage only when the database returned no boss data.
          const storageKey = `upcoming_assignments_${guildCode}_${seasonNumber}`
          const loadFromStorage = (raw: string) => {
            const parsed = JSON.parse(raw) as {
              seasonNumber?: string
              selectedBosses?: Record<string, string>
              selectedSubBosses?: Record<string, string>
              skippedPrimes?: Record<string, boolean>
            }

            actions.setSelectedBosses(parsed.selectedBosses || {})

            if (parsed.selectedSubBosses) {
              actions.setSelectedSubBosses(parsed.selectedSubBosses)
            }

            if (parsed.skippedPrimes) {
              actions.setSkippedPrimes(parsed.skippedPrimes)
            }

            actions.setSaveMessage('Loaded from local storage')
            setTimeout(() => actions.setSaveMessage(''), 3000)
          }

          const saved = localStorage.getItem(storageKey)
          if (saved) {
            loadFromStorage(saved)
          } else {
            const legacyKey = `upcoming_assignments_${guildCode}`
            const legacySaved = localStorage.getItem(legacyKey)
            if (legacySaved) {
              try {
                const legacyData = JSON.parse(legacySaved) as {
                  seasonNumber?: string
                }
                if (
                  legacyData.seasonNumber &&
                  legacyData.seasonNumber === seasonNumber
                ) {
                  localStorage.setItem(storageKey, legacySaved)
                  localStorage.removeItem(legacyKey)
                  loadFromStorage(legacySaved)
                } else {
                  localStorage.removeItem(legacyKey)
                }
              } catch {
                localStorage.removeItem(legacyKey)
              }
            }
          }
        }
      } catch (error) {
        logger.error({ err: error }, 'Error loading saved assignments:')
      }
    }

    if (state.latestSeason) {
      loadSavedAssignmentsData()
    }
  }, [guildCode, state.latestSeason, computeTargetSeason, actions, mode])
}
