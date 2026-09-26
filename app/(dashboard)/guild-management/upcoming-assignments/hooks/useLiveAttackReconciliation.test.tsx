// AUTH-CRITICAL: reconciliation auto-saves, so canEdit=false must never reach autoSave or
// dispatch allocations.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLiveAttackReconciliation } from '@/app/(dashboard)/guild-management/upcoming-assignments/hooks/useLiveAttackReconciliation'
import type { CurrentBossAssignmentRow } from '@/app/(dashboard)/guild-management/upcoming-assignments/components/CurrentBossAssignmentsPanel'

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

// One live attack beyond plan: Alpha planned 1 token on M1 but has used 2.
const UNPLANNED_ROW: CurrentBossAssignmentRow = {
  playerId: 'p1',
  displayName: 'Alpha',
  tokensAvailable: 2,
  timeToNextToken: null,
  target: 'Szarekh',
  targetId: 'M1',
  targetRemainingHp: 1000000,
  planned: 1,
  used: 2,
  remaining: 0,
  avgDamage: 750000,
  actualDamage: 1500000,
  estHpRemaining: null,
  unplanned: true
}

const buildActions = () => ({
  getLatestState: () => ({
    skippedPrimes: {},
    playerTokenAllocations: { Alpha: { M1: 1 } },
    players: [{ player_id: 'p1', display_name: 'Alpha' }]
  }),
  setPlayerTokenAllocations: vi.fn(),
  setSaveMessage: vi.fn()
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLiveAttackReconciliation read-only gate (WI-5450)', () => {
  it('canEdit=false: never dispatches allocations and never calls autoSave, even after the debounce', () => {
    const actions = buildActions()
    const autoSave = vi.fn(async () => {})

    renderHook(() =>
      useLiveAttackReconciliation({
        canEdit: false,
        mode: 'current',
        currentStageCode: 'M1',
        actions: actions as never,
        currentBossRows: [UNPLANNED_ROW],
        autoSave
      })
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(actions.setPlayerTokenAllocations).not.toHaveBeenCalled()
    expect(actions.setSaveMessage).not.toHaveBeenCalled()
    expect(autoSave).not.toHaveBeenCalled()
  })

  it('canEdit=true: reallocates the unplanned token and auto-saves after the 1.5s debounce', () => {
    const actions = buildActions()
    const autoSave = vi.fn(async () => {})

    renderHook(() =>
      useLiveAttackReconciliation({
        canEdit: true,
        mode: 'current',
        currentStageCode: 'M1',
        actions: actions as never,
        currentBossRows: [UNPLANNED_ROW],
        autoSave
      })
    )

    // Synchronous on mount: allocation bumped to live usage (1 -> 2), toast dispatched.
    expect(actions.setPlayerTokenAllocations).toHaveBeenCalledWith({
      Alpha: { M1: 2 }
    })
    expect(actions.setSaveMessage).toHaveBeenCalledWith(
      'Live attacks detected: adjusting assignments...'
    )
    expect(autoSave).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(autoSave).toHaveBeenCalledTimes(1)
    expect(autoSave).toHaveBeenCalledWith({ Alpha: { M1: 2 } })
    expect(actions.setSaveMessage).toHaveBeenLastCalledWith('')
  })

  it('preserves a reserved player name when no allocation bucket exists yet', () => {
    const actions = {
      getLatestState: () => ({
        skippedPrimes: {},
        playerTokenAllocations: {},
        players: [{ player_id: 'p1', display_name: '__proto__' }]
      }),
      setPlayerTokenAllocations: vi.fn(),
      setSaveMessage: vi.fn()
    }
    const autoSave = vi.fn(async () => {})

    renderHook(() =>
      useLiveAttackReconciliation({
        canEdit: true,
        mode: 'current',
        currentStageCode: 'M1',
        actions: actions as never,
        currentBossRows: [
          {
            ...UNPLANNED_ROW,
            displayName: '__proto__',
            planned: 0,
            used: 1
          }
        ],
        autoSave
      })
    )

    const nextAllocations = actions.setPlayerTokenAllocations.mock.calls[0]?.[0]
    expect(Object.hasOwn(nextAllocations, '__proto__')).toBe(true)
    expect(JSON.stringify(nextAllocations)).toBe('{"__proto__":{"M1":1}}')
    expect(Object.getPrototypeOf(nextAllocations)).toBe(Object.prototype)
  })
})
