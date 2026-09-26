/** Tokens count Battle only; `killed` includes Bomb kills. */

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'

export interface ClusterBossMatrixRow {
  guild_code: string
  boss_name: string
  rarity: string
  set: number
  encounter_id: number
  loop_index: number
  tokens: number
  total_damage: number
  finisher_tokens: number
  finisher_damage: number
  killed: boolean
}

export async function getClusterBossMatrixRPC(
  supabase: TypedSupabaseClient,
  filters: { clusterCode: string; season: string }
): Promise<ClusterBossMatrixRow[]> {
  // Cast the client, not the method: a detached `supabase.rpc` loses `this`.
  const client = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: ClusterBossMatrixRow[] | null; error: Error | null }>
  }
  const { data, error } = await client.rpc('get_cluster_boss_matrix', {
    p_cluster_code: filters.clusterCode,
    p_season: filters.season
  })
  if (error) throw error
  return data ?? []
}

export interface BossColumn {
  key: string
  label: string
  levelLabel: string
  bossLabel: string
  rarity: string
  /** 0-indexed, as stored in EOT_GR_data. */
  set: number
}

export interface DamageCell {
  value: number | null
}

export interface TokenCell {
  value: number | null
  live: boolean
}

export interface ClusterBossMatrices {
  loops: number[]
  selectedLoop: number | null
  columns: BossColumn[]
  guilds: string[]
  damage: Record<string, Record<string, DamageCell>>
  tokens: Record<string, Record<string, TokenCell>>
}

export interface BuildMatricesOptions {
  loopIndex: number | null
  includeFinishers: boolean
  includeSideBosses: boolean
}

const levelPrefix = (rarity: string): string =>
  rarity === 'Mythic' ? 'M' : 'L'

const columnKey = (rarity: string, set: number): string =>
  `${levelPrefix(rarity)}${set + 1}`

const rarityRank = (rarity: string): number => (rarity === 'Mythic' ? 1 : 0)

export function buildClusterBossMatrices(
  rows: ClusterBossMatrixRow[],
  opts: BuildMatricesOptions
): ClusterBossMatrices {
  const empty: ClusterBossMatrices = {
    loops: [],
    selectedLoop: null,
    columns: [],
    guilds: [],
    damage: {},
    tokens: {}
  }
  if (!rows.length) return empty

  const loops = Array.from(new Set(rows.map((r) => r.loop_index))).sort(
    (a, b) => a - b
  )
  const selectedLoop =
    opts.loopIndex !== null && loops.includes(opts.loopIndex)
      ? opts.loopIndex
      : (loops[loops.length - 1] ?? null)
  if (selectedLoop === null) return { ...empty, loops }

  const loopRows = rows.filter((r) => r.loop_index === selectedLoop)
  if (!loopRows.length) {
    return { ...empty, loops, selectedLoop }
  }

  const columnMap = new Map<string, BossColumn>()
  for (const r of loopRows) {
    const key = columnKey(r.rarity, r.set)
    const existing = columnMap.get(key)
    if (!existing) {
      const levelLabel = key
      const bossLabel = getBossDisplayName(r.boss_name)
      columnMap.set(key, {
        key,
        levelLabel,
        bossLabel,
        label: `${levelLabel} · ${bossLabel}`,
        rarity: r.rarity,
        set: r.set
      })
    } else if (r.encounter_id === 0) {
      const bossLabel = getBossDisplayName(r.boss_name)
      existing.bossLabel = bossLabel
      existing.label = `${existing.levelLabel} · ${bossLabel}`
    }
  }
  const columns = Array.from(columnMap.values()).sort(
    (a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.set - b.set
  )

  const guilds = Array.from(new Set(loopRows.map((r) => r.guild_code))).sort()

  interface MainAgg {
    tokens: number
    totalDamage: number
    finisherTokens: number
    finisherDamage: number
    killed: boolean
    present: boolean
  }
  const mainAgg = new Map<string, MainAgg>()
  const sideTokens = new Map<string, { tokens: number; present: boolean }>()

  for (const r of loopRows) {
    const cellKey = `${r.guild_code}|${columnKey(r.rarity, r.set)}`

    const side = sideTokens.get(cellKey) ?? { tokens: 0, present: false }
    side.tokens += r.tokens
    side.present = true
    sideTokens.set(cellKey, side)

    if (r.encounter_id === 0) {
      const agg = mainAgg.get(cellKey) ?? {
        tokens: 0,
        totalDamage: 0,
        finisherTokens: 0,
        finisherDamage: 0,
        killed: false,
        present: false
      }
      agg.tokens += r.tokens
      agg.totalDamage += r.total_damage
      agg.finisherTokens += r.finisher_tokens
      agg.finisherDamage += r.finisher_damage
      agg.killed = agg.killed || r.killed
      agg.present = true
      mainAgg.set(cellKey, agg)
    }
  }

  const damage: Record<string, Record<string, DamageCell>> = {}
  const tokens: Record<string, Record<string, TokenCell>> = {}

  for (const guild of guilds) {
    damage[guild] = {}
    tokens[guild] = {}
    for (const col of columns) {
      const cellKey = `${guild}|${col.key}`
      const main = mainAgg.get(cellKey)
      const side = sideTokens.get(cellKey)

      let dmgValue: number | null = null
      if (main?.present) {
        const numTokens = opts.includeFinishers
          ? main.tokens
          : main.tokens - main.finisherTokens
        const numDamage = opts.includeFinishers
          ? main.totalDamage
          : main.totalDamage - main.finisherDamage
        dmgValue = numTokens > 0 ? numDamage / numTokens : null
      }
      damage[guild][col.key] = { value: dmgValue }

      let tokValue: number | null = null
      if (opts.includeSideBosses) {
        if (side?.present) tokValue = side.tokens
      } else if (main?.present) {
        tokValue = main.tokens
      }
      const live = !(main?.killed ?? false)
      tokens[guild][col.key] = { value: tokValue, live }
    }
  }

  return { loops, selectedLoop, columns, guilds, damage, tokens }
}
