import { useEffect, useRef } from 'react'
import { bossNamesMatch, getBossDisplayIndex } from '../utils/boss-helpers'
import { normalizeBossTargetId } from '@/app/lib/boss-assignments/target-ids'
import type { AssignmentActions, AssignmentState } from './useAssignmentState'

export function useAllocationMigration(
  state: AssignmentState,
  actions: AssignmentActions
): void {
  const allocationMigrationDoneRef = useRef(false)

  const selectedBossesRef = useRef(state.selectedBosses)
  const selectedSubBossesRef = useRef(state.selectedSubBosses)
  useEffect(() => {
    selectedBossesRef.current = state.selectedBosses
    selectedSubBossesRef.current = state.selectedSubBosses
  }, [state.selectedBosses, state.selectedSubBosses])

  useEffect(() => {
    if (state.players.length === 0) return
    if (Object.keys(state.playerTokenAllocations).length === 0) return
    if (allocationMigrationDoneRef.current) return

    const encounterKeyPattern = /^([ML][1-5])(_Sub[12])?$/
    const idToName = new Map(
      state.players.map((p) => [p.player_id, p.display_name])
    )
    const nameSet = new Set(state.players.map((p) => p.display_name))
    const targetRank = (targetId: string) => {
      const baseLevel = targetId.split('_')[0] ?? ''
      const baseIndex = getBossDisplayIndex(baseLevel)
      const levelIndex = baseIndex === -1 ? 99 : baseIndex
      const isPrime = targetId.includes('_Sub')
      const slot = targetId.endsWith('Sub2')
        ? 2
        : targetId.endsWith('Sub1')
          ? 1
          : 0
      return levelIndex * 10 + (isPrime ? 5 : 0) + slot
    }

    const resolveBossId = (bossName: string): string | null => {
      const matches: string[] = []

      Object.entries(selectedBossesRef.current).forEach(
        ([level, selectedBoss]) => {
          if (!selectedBoss) return
          if (bossNamesMatch(selectedBoss, bossName)) {
            matches.push(level)
          }
        }
      )

      Object.entries(selectedSubBossesRef.current).forEach(
        ([targetId, primeName]) => {
          if (!primeName) return
          if (bossNamesMatch(primeName, bossName)) {
            matches.push(targetId)
          }
        }
      )

      if (matches.length === 0) return null
      const sorted = matches
        .slice()
        .sort((a, b) => targetRank(a) - targetRank(b))
      return sorted[0] ?? null
    }

    let needsMigration = false
    Object.entries(state.playerTokenAllocations).forEach(
      ([playerKey, allocations]) => {
        if (idToName.has(playerKey) && !nameSet.has(playerKey)) {
          needsMigration = true
        }
        Object.keys(allocations || {}).forEach((bossKey) => {
          if (!encounterKeyPattern.test(bossKey.trim())) {
            needsMigration = true
          }
        })
      }
    )

    if (!needsMigration) {
      allocationMigrationDoneRef.current = true
      return
    }

    const migrated = new Map<string, Record<string, number>>()

    Object.entries(state.playerTokenAllocations).forEach(
      ([playerKey, allocations]) => {
        const playerName = idToName.get(playerKey) ?? playerKey

        const nextAllocations = new Map<string, number>()

        Object.entries(allocations || {}).forEach(([rawBossKey, rawTokens]) => {
          const tokens = typeof rawTokens === 'number' ? rawTokens : 0
          if (!tokens || tokens <= 0) return

          const bossKey = normalizeBossTargetId(rawBossKey.trim())
          const bossId = encounterKeyPattern.test(bossKey)
            ? bossKey
            : (resolveBossId(bossKey) ?? bossKey)

          nextAllocations.set(
            bossId,
            Math.min(3, (nextAllocations.get(bossId) ?? 0) + tokens)
          )
        })

        migrated.set(playerName, Object.fromEntries(nextAllocations))
      }
    )

    allocationMigrationDoneRef.current = true
    actions.setPlayerTokenAllocations(Object.fromEntries(migrated))
  }, [state.players, state.playerTokenAllocations, actions])
}
