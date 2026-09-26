// The verdict expectation is constant across the window; no per-attack curve is fabricated.

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { mainCache } from '@tacticus/app-core/unified-cache'
import { raritySetToColumns } from '@/app/lib/catalogs/rarity-set'
import type { RecentAttackPoint } from './types'

const STRONG_ATTACK_FACTOR = 1.0

export async function loadRecentAttacks(
  supabase: TypedSupabaseClient,
  args: {
    guildCode: string
    displayName: string
    season: string
    /** verdict.bossName, not verdict.bossType (which matches zero rows). */
    bossName: string
    /** Same tier as the expectation, so the chart never mixes damage scales. */
    raritySet: string | null
    expected: number | null
    limit?: number
  }
): Promise<RecentAttackPoint[]> {
  const { guildCode, displayName, season, bossName, raritySet, expected } = args
  const limit = args.limit ?? 8
  // Keyed like the meta_atlas expectation (Name + rarity_set); encounterIndex is unreliable here.
  let query = supabase
    .from('EOT_GR_data')
    .select('damageDealt, startedOn, Name')
    .eq('Guild', guildCode)
    .eq('Season', season)
    .eq('displayName', displayName)
    .eq('Name', bossName)
    .eq('damageType', 'Battle')
    .gt('damageDealt', 0)
  const rs = raritySetToColumns(raritySet)
  if (rs) query = query.eq('rarity', rs.rarity).eq('set', rs.set)
  const { data, error } = await query
    .order('startedOn', { ascending: false })
    .limit(limit)
  if (error || !data) return []

  return data
    .filter((r) => r.startedOn != null && r.damageDealt != null)
    .map((r) => ({
      startedAt: r.startedOn as string,
      damage: r.damageDealt as number,
      expected,
      bossName: r.Name
    }))
    .reverse()
}

// Per boss and tier only: cross-boss averages are incomparable (HP scales differ).
const WOW_MIN_ATTACKS_PER_WINDOW = 2
const WOW_IMPROVEMENT_FACTOR = 1.05
const WEEK_MS = 7 * 24 * 3600 * 1000
const WOW_CACHE_TTL_MS = 15 * 60 * 1000

export async function loadWeekOverWeekImprovedCount(
  supabase: TypedSupabaseClient,
  args: { guildCode: string; season: string; nowMs: number }
): Promise<number | null> {
  const { guildCode, season, nowMs } = args
  // Errors throw inside the fetcher so failures are not cached.
  return mainCache.getOrFetch(
    `officer-wow-improved:${guildCode}:${season}`,
    async () => {
      const since = new Date(nowMs - 2 * WEEK_MS).toISOString()
      const { data, error } = await supabase
        .from('EOT_GR_data')
        .select('displayName, Name, rarity, set, damageDealt, startedOn')
        .eq('Guild', guildCode)
        .eq('Season', season)
        .eq('damageType', 'Battle')
        .gt('damageDealt', 0)
        .gte('startedOn', since)
        .order('startedOn', { ascending: false })
        .limit(5000)
      if (error) {
        throw new Error(error.message ?? 'week-over-week query failed')
      }

      const buckets = new Map<
        string,
        { name: string; thisWk: number[]; lastWk: number[] }
      >()
      const weekAgo = nowMs - WEEK_MS
      for (const r of data ?? []) {
        if (
          !r.displayName ||
          !r.Name ||
          r.damageDealt == null ||
          !r.startedOn
        ) {
          continue
        }
        const t = Date.parse(r.startedOn)
        if (!Number.isFinite(t)) continue
        const key = `${r.displayName}|${r.Name}|${r.rarity ?? ''}|${r.set ?? ''}`
        const b =
          buckets.get(key) ??
          ({ name: r.displayName, thisWk: [], lastWk: [] } as {
            name: string
            thisWk: number[]
            lastWk: number[]
          })
        ;(t >= weekAgo ? b.thisWk : b.lastWk).push(r.damageDealt)
        buckets.set(key, b)
      }

      const improved = new Set<string>()
      for (const b of buckets.values()) {
        if (
          b.thisWk.length >= WOW_MIN_ATTACKS_PER_WINDOW &&
          b.lastWk.length >= WOW_MIN_ATTACKS_PER_WINDOW
        ) {
          const avg = (xs: number[]) =>
            xs.reduce((s, x) => s + x, 0) / xs.length
          if (avg(b.thisWk) > avg(b.lastWk) * WOW_IMPROVEMENT_FACTOR) {
            improved.add(b.name)
          }
        }
      }
      return improved.size
    },
    {
      ttl: WOW_CACHE_TTL_MS,
      priority: 'low',
      tags: ['officer-wow', `guild:${guildCode}`, `season:${season}`]
    }
  ) as Promise<number | null>
}

/** Consecutive latest attacks at/above expectation (points chronological); null without one. */
export function computeStrongStreak(
  points: RecentAttackPoint[]
): number | null {
  if (points.length === 0) return null
  let streak = 0
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    if (!p) continue
    if (p.expected == null) return streak > 0 ? streak : null
    if (p.damage >= p.expected * STRONG_ATTACK_FACTOR) streak++
    else break
  }
  return streak
}
