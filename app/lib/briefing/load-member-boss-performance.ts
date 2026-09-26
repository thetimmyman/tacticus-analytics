/** Target cascades playbook -> coaching -> guild average; timeout-guarded for first paint. */

import { serviceDb } from '@/app/lib/db'
import { analyzeMember } from '@/app/lib/officer-briefing/analyze-member'
import {
  loadPlaybookClearTargets,
  type PlaybookClearTargetsByKey
} from '@/app/lib/briefing/load-playbook-clear-targets'
import { columnsToRaritySet } from '@/app/lib/catalogs/rarity-set'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('briefing.member-boss-performance')

export interface MemberBossPerfRow {
  bossName: string
  encounterId: number
  guildAvg: number | null
  yourTarget: number | null
  targetSource: 'playbook' | 'coaching' | 'guild'
  yourAvg: number | null
  vsTargetPct: number | null
  vsGuildPct: number | null
  battleCount: number
  isCurrentTarget: boolean
}

export interface MemberBossPerformance {
  rows: MemberBossPerfRow[]
  overallVsGuildPct: number | null
  strongestAlternate: string | null
}

interface BossPerfRow {
  display_name: string
  boss_name?: string
  prime_name?: string
  encounter_id: number
  player_avg: number
  battle_count: number
  player_vs_guild_avg: number | null
  rarity?: string
  set_num?: number
}

interface LoadArgs {
  guildCode: string | undefined
  season: string
  displayName: string | undefined
  currentBossName: string | undefined
}

const EMPTY: MemberBossPerformance = {
  rows: [],
  overallVsGuildPct: null,
  strongestAlternate: null
}

async function load(args: LoadArgs): Promise<MemberBossPerformance> {
  if (!args.guildCode || !args.displayName) return EMPTY
  const supabase = serviceDb()

  // Not the prime RPC too: it would double-count primes under rarity-suffixed names.
  const [bossRes, engine, playbookTargets] = await Promise.all([
    supabase.rpc('get_player_boss_performance', {
      guild_code_param: args.guildCode,
      season_param: args.season
    }),
    analyzeMember({
      supabase,
      guildCode: args.guildCode,
      displayName: args.displayName,
      season: args.season,
      nowMs: Date.now()
    }).catch((err) => {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'roster-adjusted targets unavailable'
      )
      return null
    }),
    loadPlaybookClearTargets(supabase, args.guildCode, args.season).catch(
      (err): PlaybookClearTargetsByKey => {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          'playbook clear targets unavailable'
        )
        return new Map()
      }
    )
  ])

  const myRows = (
    (bossRes.data as unknown as BossPerfRow[] | null) ?? []
  ).filter((r) => r.display_name === args.displayName)
  if (myRows.length === 0) return EMPTY

  // Roll up slices weighted by battle_count; first-wins dedup would bias toward one slice.
  interface Acc {
    bossName: string
    encounterId: number
    playerW: number // Σ player_avg·bc
    guildW: number // Σ guildAvg_slice·bc (only slices with a known vs)
    guildBattles: number
    battles: number
    playbookW: number // Σ requiredDpt·bc over slices with a playbook target
    playbookBattles: number
  }
  const accByKey = new Map<string, Acc>()
  for (const r of myRows) {
    const bossName = r.boss_name ?? r.prime_name ?? 'Unknown'
    const key = `${bossName}::${r.encounter_id}`
    const bc = r.battle_count || 0
    const acc =
      accByKey.get(key) ??
      ({
        bossName,
        encounterId: r.encounter_id,
        playerW: 0,
        guildW: 0,
        guildBattles: 0,
        battles: 0,
        playbookW: 0,
        playbookBattles: 0
      } satisfies Acc)
    acc.playerW += r.player_avg * bc
    acc.battles += bc
    if (r.player_vs_guild_avg != null && r.player_vs_guild_avg !== -100) {
      acc.guildW += (r.player_avg / (1 + r.player_vs_guild_avg / 100)) * bc
      acc.guildBattles += bc
    }
    // Per-slice target, so an L4-only member never sees M2's.
    const raritySet = columnsToRaritySet(r.rarity, r.set_num)
    if (raritySet) {
      const pb = playbookTargets.get(
        `${bossName}::${r.encounter_id}::${raritySet}`
      )
      if (pb && pb.requiredDpt > 0) {
        acc.playbookW += pb.requiredDpt * bc
        acc.playbookBattles += bc
      }
    }
    accByKey.set(key, acc)
  }

  const tgtByKey = new Map<string, { w: number; bc: number }>()
  for (const v of engine?.verdicts ?? []) {
    if (v.expectedForBestFieldable == null) continue
    const key = `${v.bossName}::${v.encounterId}`
    const bc = v.battleCount || 1
    const t = tgtByKey.get(key) ?? { w: 0, bc: 0 }
    t.w += v.expectedForBestFieldable * bc
    t.bc += bc
    tgtByKey.set(key, t)
  }

  const rows: MemberBossPerfRow[] = [...accByKey.values()].map((a) => {
    const yourAvg = a.battles > 0 ? a.playerW / a.battles : null
    const guildAvg = a.guildBattles > 0 ? a.guildW / a.guildBattles : null
    const vsGuildPct =
      yourAvg != null && guildAvg && guildAvg > 0
        ? ((yourAvg - guildAvg) / guildAvg) * 100
        : null
    const playbookVal =
      a.playbookBattles > 0 ? a.playbookW / a.playbookBattles : null
    const coaching = tgtByKey.get(`${a.bossName}::${a.encounterId}`)
    const coachingVal =
      coaching && coaching.bc > 0 ? coaching.w / coaching.bc : null
    let yourTarget: number | null
    let targetSource: MemberBossPerfRow['targetSource']
    if (playbookVal != null && playbookVal > 0) {
      yourTarget = playbookVal
      targetSource = 'playbook'
    } else if (coachingVal != null) {
      yourTarget = coachingVal
      targetSource = 'coaching'
    } else {
      yourTarget = guildAvg
      targetSource = 'guild'
    }
    const vsTargetPct =
      yourAvg != null && yourTarget && yourTarget > 0
        ? ((yourAvg - yourTarget) / yourTarget) * 100
        : null
    return {
      bossName: a.bossName,
      encounterId: a.encounterId,
      guildAvg,
      yourTarget,
      targetSource,
      yourAvg,
      vsTargetPct,
      vsGuildPct,
      battleCount: a.battles,
      isCurrentTarget:
        Boolean(args.currentBossName) &&
        a.bossName.toLowerCase() === args.currentBossName!.toLowerCase() &&
        a.encounterId === 0
    }
  })

  rows.sort((a, b) => {
    if (a.isCurrentTarget !== b.isCurrentTarget)
      return a.isCurrentTarget ? -1 : 1
    if (a.encounterId !== b.encounterId) return a.encounterId - b.encounterId
    return b.battleCount - a.battleCount
  })

  let wSum = 0
  let w = 0
  for (const r of rows) {
    if (r.vsGuildPct != null) {
      wSum += r.vsGuildPct * r.battleCount
      w += r.battleCount
    }
  }
  const overallVsGuildPct = w > 0 ? wSum / w : null

  const alt = rows
    .filter((r) => !r.isCurrentTarget && (r.vsTargetPct ?? -Infinity) > 0)
    .sort((a, b) => (b.vsTargetPct ?? 0) - (a.vsTargetPct ?? 0))[0]

  return {
    rows,
    overallVsGuildPct,
    strongestAlternate: alt?.bossName ?? null
  }
}

export async function loadMemberBossPerformance(
  args: LoadArgs,
  timeoutMs = 4000
): Promise<MemberBossPerformance> {
  const timeout = new Promise<MemberBossPerformance>((resolve) =>
    setTimeout(() => resolve(EMPTY), timeoutMs)
  )
  return Promise.race([load(args).catch(() => EMPTY), timeout])
}
