import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlayerData } from '@/app/(dashboard)/guild-management/upcoming-assignments/hooks/usePlayerData'
import { useAllocationMigration } from '@/app/(dashboard)/guild-management/upcoming-assignments/hooks/useAllocationMigration'
import type {
  AssignmentActions,
  AssignmentState
} from '@/app/(dashboard)/guild-management/upcoming-assignments/hooks/useAssignmentState'
import type {
  AssignmentRow,
  PlayerTokenAllocations
} from '@/app/(dashboard)/guild-management/upcoming-assignments/types'

const dependencies = vi.hoisted(() => ({
  useBaseQuery: vi.fn(),
  useGuildMembers: vi.fn()
}))

vi.mock('@/app/lib/hooks/shared', () => ({
  useBaseQuery: dependencies.useBaseQuery,
  useGuildMembers: dependencies.useGuildMembers
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: vi.fn()
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    error: vi.fn(),
    info: vi.fn()
  })
}))

function createActions() {
  const setPlayers = vi.fn()
  const setPlayerTokenAllocations = vi.fn()

  return {
    actions: {
      setPlayers,
      setPlayerTokenAllocations
    } as unknown as AssignmentActions,
    setPlayerTokenAllocations
  }
}

function expectReservedAllocation(
  allocations: PlayerTokenAllocations,
  playerKey: string,
  expectedTokens: Record<string, number>
) {
  expect(Object.getPrototypeOf(allocations)).toBe(Object.prototype)
  expect(Object.hasOwn(allocations, playerKey)).toBe(true)

  const playerAllocations = allocations[playerKey]
  expect(Object.getPrototypeOf(playerAllocations)).toBe(Object.prototype)
  expect(playerAllocations).toEqual(expectedTokens)
  expect(JSON.parse(JSON.stringify(allocations))).toEqual(
    Object.fromEntries([[playerKey, expectedTokens]])
  )
}

describe('allocation records with reserved property names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dependencies.useGuildMembers.mockReturnValue({
      isLoading: false,
      members: []
    })
    dependencies.useBaseQuery.mockReturnValue({
      isLoading: false,
      data: []
    })
  })

  it('loads a reserved display name and target id from saved assignments', async () => {
    dependencies.useGuildMembers.mockReturnValue({
      isLoading: false,
      members: [
        {
          playerId: 'player-1',
          displayName: '__proto__',
          isActive: true
        }
      ]
    })
    dependencies.useBaseQuery.mockReturnValue({
      isLoading: false,
      data: [
        {
          player_id: 'player-1',
          display_name: '__proto__',
          primary_boss: null,
          secondary_boss: null,
          token_allocations: Object.fromEntries([['__proto__', 2]]),
          uses_flexible_tokens: false
        } satisfies AssignmentRow
      ]
    })
    const { actions, setPlayerTokenAllocations } = createActions()

    renderHook(() =>
      usePlayerData(
        {} as AssignmentState,
        actions,
        'GUILD',
        () => '111',
        'current',
        2,
        1
      )
    )

    await waitFor(() => expect(setPlayerTokenAllocations).toHaveBeenCalled())
    const allocations = setPlayerTokenAllocations.mock.calls[0]?.[0]
    expectReservedAllocation(allocations, '__proto__', {
      ['__proto__']: 2
    })
  })

  it('builds defaults for reserved display names and boss ids', async () => {
    dependencies.useGuildMembers.mockReturnValue({
      isLoading: false,
      members: [
        {
          playerId: 'player-1',
          displayName: '__proto__',
          isActive: true,
          primaryBoss: '__proto__',
          secondaryBoss: 'constructor'
        }
      ]
    })
    const { actions, setPlayerTokenAllocations } = createActions()

    renderHook(() =>
      usePlayerData(
        {} as AssignmentState,
        actions,
        'GUILD',
        () => '111',
        'current',
        2,
        1
      )
    )

    await waitFor(() => expect(setPlayerTokenAllocations).toHaveBeenCalled())
    const allocations = setPlayerTokenAllocations.mock.calls[0]?.[0]
    expectReservedAllocation(allocations, '__proto__', {
      ['__proto__']: 2,
      constructor: 1
    })
  })

  it('migrates a player id to a reserved display name without losing keys', async () => {
    const sourceAllocations: PlayerTokenAllocations = Object.fromEntries([
      [
        'player-1',
        Object.fromEntries([
          ['L4_main', 2],
          ['__proto__', 1]
        ])
      ]
    ])
    const state = {
      players: [
        {
          player_id: 'player-1',
          display_name: '__proto__',
          primary_boss: null,
          secondary_boss: null
        }
      ],
      playerTokenAllocations: sourceAllocations,
      selectedBosses: {},
      selectedSubBosses: {}
    } as AssignmentState
    const { actions, setPlayerTokenAllocations } = createActions()

    renderHook(() => useAllocationMigration(state, actions))

    await waitFor(() => expect(setPlayerTokenAllocations).toHaveBeenCalled())
    const allocations = setPlayerTokenAllocations.mock.calls[0]?.[0]
    expectReservedAllocation(allocations, '__proto__', {
      L4: 2,
      ['__proto__']: 1
    })
  })
})
