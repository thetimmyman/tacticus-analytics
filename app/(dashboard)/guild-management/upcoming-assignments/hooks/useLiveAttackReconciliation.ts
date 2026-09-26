import { useEffect, useRef } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
import type { CurrentBossAssignmentRow } from '../components/CurrentBossAssignmentsPanel'
import type { AssignmentActions } from './useAssignmentState'
import type { PlayerTokenAllocations } from '../types'

const logger = createComponentLogger(
  'guild-management.upcoming-assignments.UpcomingAssignmentsClient'
)

export function useLiveAttackReconciliation({
  canEdit,
  mode,
  currentStageCode,
  actions,
  currentBossRows,
  autoSave
}: {
  canEdit: boolean
  mode: 'current'
  currentStageCode: string | null
  actions: AssignmentActions
  currentBossRows: CurrentBossAssignmentRow[]
  autoSave: (allocations?: PlayerTokenAllocations) => Promise<void>
}): void {
  const attackAdjustSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const processedUnplannedAttacksRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    return () => {
      if (attackAdjustSaveTimeoutRef.current) {
        clearTimeout(attackAdjustSaveTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    // AUTH-CRITICAL: reconciliation auto-saves, so it never runs for read-only members.
    if (!canEdit) return
    if (mode !== 'current') return
    if (!currentStageCode) return

    const latest = actions.getLatestState()
    const unplannedRows = currentBossRows.filter((row) => {
      if (!row.unplanned || row.used <= row.planned) return false
      // Attacks on skipped primes are intentional, not "unplanned".
      if (latest.skippedPrimes[row.targetId]) return false
      return true
    })
    if (unplannedRows.length === 0) return

    const newUnplannedRows = unplannedRows.filter((row) => {
      const key = `${row.playerId}:${row.targetId}:${row.used}`
      return !processedUnplannedAttacksRef.current.has(key)
    })
    if (newUnplannedRows.length === 0) return
    const allocationEntries = new Map(
      Object.entries(latest.playerTokenAllocations)
    )
    let changed = false

    const playersById = new Map(
      latest.players.map((player) => [player.player_id, player])
    )

    newUnplannedRows.forEach((row) => {
      const key = `${row.playerId}:${row.targetId}:${row.used}`
      processedUnplannedAttacksRef.current.add(key)

      const player = playersById.get(row.playerId)
      if (!player) return

      const allocationKey = player.display_name
      const baseAllocations =
        allocationEntries.get(allocationKey) ||
        allocationEntries.get(player.player_id) ||
        {}
      const allocations: Record<string, number> = { ...baseAllocations }

      const targetId = row.targetId
      const planned =
        typeof allocations[targetId] === 'number' ? allocations[targetId] : 0
      const delta = Math.max(0, row.used - planned)
      if (delta === 0) return

      for (let i = 0; i < delta; i += 1) {
        const donor = Object.entries(allocations)
          .filter(
            ([bossKey, tokens]) =>
              bossKey !== targetId && typeof tokens === 'number' && tokens > 0
          )
          .sort(
            (a, b) =>
              (b[1] as number) - (a[1] as number) || a[0].localeCompare(b[0])
          )[0]

        if (donor) {
          const donorKey = donor[0]
          const updated = (allocations[donorKey] || 0) - 1
          if (updated <= 0) {
            delete allocations[donorKey]
          } else {
            allocations[donorKey] = updated
          }
        }

        allocations[targetId] = (allocations[targetId] || 0) + 1
      }

      allocationEntries.set(allocationKey, allocations)
      changed = true
    })

    if (!changed) return

    const nextAllocations = Object.fromEntries(
      allocationEntries
    ) as PlayerTokenAllocations

    actions.setPlayerTokenAllocations(nextAllocations)
    actions.setSaveMessage('Live attacks detected: adjusting assignments...')

    if (attackAdjustSaveTimeoutRef.current) {
      clearTimeout(attackAdjustSaveTimeoutRef.current)
    }

    attackAdjustSaveTimeoutRef.current = setTimeout(() => {
      autoSave(nextAllocations).catch((error) => {
        logger.error(
          { err: error },
          'Failed to auto-save adjusted assignments:'
        )
      })
      actions.setSaveMessage('')
      attackAdjustSaveTimeoutRef.current = null
    }, 1500)
  }, [actions, autoSave, currentBossRows, currentStageCode, mode, canEdit])
}
