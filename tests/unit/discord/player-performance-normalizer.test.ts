import { describe, it, expect } from 'vitest'
import { normalizeRpcRow } from '@/app/lib/calculations/experimental/player-boss-performance'

function toPlayerBossRow(row: Record<string, unknown>) {
  const n = normalizeRpcRow(row)
  return {
    boss_name: n.boss_name,
    vs_guild_pct: n.vs_guild_pct ?? 0,
    vs_cluster_pct: n.vs_cluster_pct ?? 0,
    battle_count: n.battle_count ?? 0,
    set: n.set,
    rarity: n.rarity
  }
}

describe('Discord player-performance normalizer parity', () => {
  it('normalizes 2-arg RPC column names (player_vs_guild_avg variant)', () => {
    const row = {
      boss_name: 'Belisarius Cawl_Legendary',
      tier: 6,
      set_num: 1,
      rarity: 'Legendary',
      encounter_id: 0,
      battle_count: 10,
      player_avg: 250000,
      player_vs_guild_avg: 25,
      player_vs_cluster_avg: 38.9,
      biggest_hit: 500000,
      boss_preference: 'neutral',
      display_name: 'TestPlayer'
    }

    const result = toPlayerBossRow(row)
    expect(result.boss_name).toBe('Belisarius Cawl_Legendary')
    expect(result.vs_guild_pct).toBe(25)
    expect(result.vs_cluster_pct).toBe(38.9)
    expect(result.battle_count).toBe(10)
    expect(result.set).toBe(1)
    expect(result.rarity).toBe('Legendary')
  })

  it('normalizes clean column names (post-migration)', () => {
    const row = {
      boss_name: 'Hive Tyrant_Mythic',
      tier: 8,
      set: 2,
      rarity: 'Mythic',
      encounter_id: 0,
      battle_count: 15,
      player_avg: 300000,
      guild_avg: 250000,
      cluster_avg: 220000,
      vs_guild_pct: 20,
      vs_cluster_pct: 36.4,
      weighted_contribution: 4.1,
      display_name: 'CleanPlayer'
    }

    const result = toPlayerBossRow(row)
    expect(result.boss_name).toBe('Hive Tyrant_Mythic')
    expect(result.vs_guild_pct).toBe(20)
    expect(result.vs_cluster_pct).toBe(36.4)
    expect(result.battle_count).toBe(15)
    expect(result.set).toBe(2)
    expect(result.rarity).toBe('Mythic')
  })

  it('handles numeric string values', () => {
    const row = {
      boss_name: 'Rogal Dorn_Legendary',
      battle_count: '8', // string instead of number
      vs_guild_pct: '15.5', // string instead of number
      vs_cluster_pct: '-5.2', // negative string
      set: '3', // string instead of number
      rarity: 'Legendary',
      player_avg: '180000',
      guild_avg: '156000',
      display_name: 'StringPlayer'
    }

    const result = toPlayerBossRow(row)
    expect(result.boss_name).toBe('Rogal Dorn_Legendary')
    expect(result.battle_count).toBe(8)
    expect(result.vs_guild_pct).toBe(15.5)
    expect(result.vs_cluster_pct).toBe(-5.2)
    expect(result.set).toBe(3)
  })

  it('handles null and missing optional fields', () => {
    const row = {
      boss_name: 'Avatar_Legendary',
      battle_count: 5,
      vs_guild_pct: null,
      vs_cluster_pct: null,
      set: null,
      rarity: null,
      player_avg: 100000,
      guild_avg: 0, // zero guild avg means vs_guild computed as 0
      cluster_avg: 0,
      display_name: 'NullPlayer'
    }

    const result = toPlayerBossRow(row)
    expect(result.boss_name).toBe('Avatar_Legendary')
    expect(result.battle_count).toBe(5)
    expect(result.vs_guild_pct).toBe(0)
    expect(result.vs_cluster_pct).toBe(0)
    expect(result.set).toBeNull()
    expect(result.rarity).toBeNull()
  })

  it('computes vs_guild_pct from averages when pct field is missing', () => {
    const row = {
      boss_name: 'Silent King_Mythic',
      battle_count: 12,
      player_avg: 300000,
      guild_avg: 200000, // player is 50% above guild
      cluster_avg: 250000, // player is 20% above cluster
      display_name: 'ComputedPlayer'
    }

    const result = toPlayerBossRow(row)
    expect(result.vs_guild_pct).toBeCloseTo(50, 5) // ((300000/200000) - 1) * 100
    expect(result.vs_cluster_pct).toBeCloseTo(20, 5) // ((300000/250000) - 1) * 100
  })

  it('filters out rows with empty boss_name or zero battle_count', () => {
    const rows = [
      { boss_name: '', battle_count: 5, display_name: 'P1' },
      { boss_name: 'Boss', battle_count: 0, display_name: 'P1' },
      { boss_name: 'Boss', battle_count: 3, display_name: 'P1' }
    ]

    const results = rows
      .map((r) => toPlayerBossRow(r))
      .filter((r) => r.boss_name && r.battle_count > 0)

    expect(results).toHaveLength(1)
    expect(results[0].boss_name).toBe('Boss')
  })
})
