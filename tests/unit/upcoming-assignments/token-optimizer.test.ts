import { describe, expect, it } from 'vitest'
import {
  convertToPrimarySecondary,
  type PlayerTokenAllocation
} from '@/app/(dashboard)/guild-management/upcoming-assignments/utils/token-optimizer'

describe('convertToPrimarySecondary', () => {
  it('converts allocations to primary/secondary format', () => {
    const allocations: PlayerTokenAllocation[] = [
      {
        player_id: 'p1',
        display_name: 'Player1',
        allocations: { BossA: 2, BossB: 1 },
        totalTokensUsed: 3
      }
    ]

    const result = convertToPrimarySecondary(allocations, 2, 1)

    expect(result).toHaveLength(1)
    expect(result[0].player_id).toBe('p1')
    expect(result[0].primary_boss).toBe('BossA')
    expect(result[0].secondary_boss).toBe('BossB')
    expect(result[0].token_allocations).toEqual({ BossA: 2, BossB: 1 })
  })

  it('handles single allocation', () => {
    const allocations: PlayerTokenAllocation[] = [
      {
        player_id: 'p1',
        display_name: 'Player1',
        allocations: { BossA: 3 },
        totalTokensUsed: 3
      }
    ]

    const result = convertToPrimarySecondary(allocations, 2, 1)

    expect(result[0].primary_boss).toBe('BossA')
    expect(result[0].secondary_boss).toBeNull()
  })

  it('handles empty allocations', () => {
    const allocations: PlayerTokenAllocation[] = [
      {
        player_id: 'p1',
        display_name: 'Player1',
        allocations: {},
        totalTokensUsed: 0
      }
    ]

    const result = convertToPrimarySecondary(allocations, 2, 1)

    expect(result[0].primary_boss).toBeNull()
    expect(result[0].secondary_boss).toBeNull()
  })

  it('falls back to the HIGHEST allocation as primary when none meets the primary threshold', () => {
    // The fallback must pick the top-sorted boss, not the first inserted.
    const allocations: PlayerTokenAllocation[] = [
      {
        player_id: 'p1',
        display_name: 'Player1',
        allocations: { BossA: 1, BossB: 2 },
        totalTokensUsed: 3
      }
    ]

    const result = convertToPrimarySecondary(allocations, 3, 1)

    expect(result[0].primary_boss).toBe('BossB')
    // Secondary collapses onto the same boss (current behaviour).
    expect(result[0].secondary_boss).toBe('BossB')
  })

  it('assigns lower-token boss as secondary when only the primary threshold is met', () => {
    const allocations: PlayerTokenAllocation[] = [
      {
        player_id: 'p1',
        display_name: 'Player1',
        allocations: { BossA: 2, BossB: 1 },
        totalTokensUsed: 3
      }
    ]

    const result = convertToPrimarySecondary(allocations, 2, 1)

    expect(result[0].primary_boss).toBe('BossA')
    expect(result[0].secondary_boss).toBe('BossB')
  })

  it('handles multiple players', () => {
    const allocations: PlayerTokenAllocation[] = [
      {
        player_id: 'p1',
        display_name: 'Player1',
        allocations: { BossA: 2, BossB: 1 },
        totalTokensUsed: 3
      },
      {
        player_id: 'p2',
        display_name: 'Player2',
        allocations: { BossB: 2, BossC: 1 },
        totalTokensUsed: 3
      }
    ]

    const result = convertToPrimarySecondary(allocations, 2, 1)

    expect(result).toHaveLength(2)
    expect(result[0].primary_boss).toBe('BossA')
    expect(result[0].secondary_boss).toBe('BossB')
    expect(result[1].primary_boss).toBe('BossB')
    expect(result[1].secondary_boss).toBe('BossC')
  })
})
