import { describe, it, expect } from 'vitest'
import { normalizeTokenUsageRow } from '@/app/lib/types/token-usage-rpc'
import type { TokenUsageRpcRowRaw } from '@/app/lib/types/token-usage-rpc'

describe('normalizeTokenUsageRow', () => {
  it('normalizes canonical field names', () => {
    const row: TokenUsageRpcRowRaw = {
      player_id: 'p1',
      display_name: 'Player One',
      tokens_used: 42,
      max_possible: 48,
      tokens_below_offender: true,
      tokens_below_abuser: false,
      boss_tokens: 30,
      prime_tokens: 12,
      bombs_used: 3,
      bombs_available: 1,
      burned_tokens: 2,
      time_over_cap_seconds: 3700
    }

    const result = normalizeTokenUsageRow(row)
    expect(result.player_id).toBe('p1')
    expect(result.display_name).toBe('Player One')
    expect(result.tokens_used).toBe(42)
    expect(result.max_possible).toBe(48)
    expect(result.tokens_below_offender).toBe(true)
    expect(result.tokens_below_abuser).toBe(false)
    expect(result.boss_tokens).toBe(30)
    expect(result.prime_tokens).toBe(12)
    expect(result.bombs_used).toBe(3)
    expect(result.bombs_available).toBe(1)
    expect(result.burned_tokens).toBe(2)
    expect(result.time_over_cap_seconds).toBe(3700)
  })

  it('resolves legacy variant field names', () => {
    const row: TokenUsageRpcRowRaw = {
      user_id: 'u2',
      displayName: 'Legacy Player',
      token_count: 35
    }

    const result = normalizeTokenUsageRow(row)
    expect(result.player_id).toBe('u2')
    expect(result.display_name).toBe('Legacy Player')
    expect(result.tokens_used).toBe(35)
  })

  it('prefers canonical over legacy when both present', () => {
    const row: TokenUsageRpcRowRaw = {
      player_id: 'canonical',
      user_id: 'legacy',
      display_name: 'Canonical Name',
      displayName: 'Legacy Name',
      tokens_used: 50,
      token_count: 40
    }

    const result = normalizeTokenUsageRow(row)
    expect(result.player_id).toBe('canonical')
    expect(result.display_name).toBe('Canonical Name')
    expect(result.tokens_used).toBe(50)
  })

  it('applies correct defaults for missing fields', () => {
    const row: TokenUsageRpcRowRaw = {}

    const result = normalizeTokenUsageRow(row)
    expect(result.player_id).toBe('')
    expect(result.display_name).toBe('')
    expect(result.tokens_used).toBe(0)
    expect(result.max_possible).toBe(0)
    expect(result.tokens_below_offender).toBe(false)
    expect(result.tokens_below_abuser).toBe(false)
    expect(result.boss_tokens).toBe(0)
    expect(result.prime_tokens).toBe(0)
    expect(result.bombs_used).toBe(0)
    expect(result.bombs_available).toBe(0)
    expect(result.burned_tokens).toBe(0)
    expect(result.time_over_cap_seconds).toBe(0)
  })

  it('applies correct defaults for null fields', () => {
    const row: TokenUsageRpcRowRaw = {
      player_id: null,
      display_name: null,
      tokens_used: null,
      max_possible: null,
      tokens_below_offender: null,
      boss_tokens: null,
      burned_tokens: null,
      time_over_cap_seconds: null
    }

    const result = normalizeTokenUsageRow(row)
    expect(result.player_id).toBe('')
    expect(result.display_name).toBe('')
    expect(result.tokens_used).toBe(0)
    expect(result.max_possible).toBe(0)
    expect(result.tokens_below_offender).toBe(false)
    expect(result.boss_tokens).toBe(0)
    expect(result.burned_tokens).toBe(0)
    expect(result.time_over_cap_seconds).toBe(0)
  })

  it('coerces numeric strings via Number()', () => {
    const row = {
      player_id: 'p3',
      display_name: 'StringPlayer',
      tokens_used: '42' as unknown as number,
      max_possible: '48' as unknown as number,
      boss_tokens: '30' as unknown as number,
      burned_tokens: '5' as unknown as number
    } as TokenUsageRpcRowRaw

    const result = normalizeTokenUsageRow(row)
    expect(result.tokens_used).toBe(42)
    expect(result.max_possible).toBe(48)
    expect(result.boss_tokens).toBe(30)
    expect(result.burned_tokens).toBe(5)
  })
})
