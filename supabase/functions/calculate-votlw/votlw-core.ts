// VOTLW points from the canonical SQL award RPCs the web page uses; extend the RPCs, never add award
// math here (a local copy drifts). No Deno imports, so it runs under vitest.

import { resolveDisplayName } from '../_shared/player-name-resolution-core.ts'

export type SeasonAwardsDataRow = {
  display_name?: string | null
  user_id?: string | null
  damage_dealt?: number | null
}

export type RpcAwardEntry = {
  player?: string | null
  value?: number | null
} | null

export type RpcSetWinnerRow = {
  rarity?: string | null
  set?: number | null
  levelString?: string | null
  bossName?: string | null
  gold?: RpcAwardEntry
  silver?: RpcAwardEntry
  bronze?: RpcAwardEntry
  mostDamage?: RpcAwardEntry
  sideBoss1?: RpcAwardEntry
  sideBoss2?: RpcAwardEntry
  biggestHit?: RpcAwardEntry
}

export type AwardEntry = {
  player: string
  value: number
}

export type SeasonAwards = {
  topKiller: AwardEntry
  bestBomber: AwardEntry
}

export type PlayerPointSummary = {
  player: string
  totalPoints: number
  goldMedals: number
  silverMedals: number
  bronzeMedals: number
}

// Top killer = most last hits (`last_hits` holds every Battle row that left the
// boss at 0 HP); best bomber = single biggest positive bomb.
export function calculateSeasonAwards(
  lastHits: SeasonAwardsDataRow[],
  bombData: SeasonAwardsDataRow[],
  playerNameMap: Map<string, string>
): SeasonAwards {
  const killCounts: Record<string, number> = {}
  lastHits.forEach((entry) => {
    const resolvedName = resolveDisplayName(
      entry.display_name ?? undefined,
      entry.user_id ?? undefined,
      playerNameMap
    )
    killCounts[resolvedName] = (killCounts[resolvedName] || 0) + 1
  })
  const topKillerEntry = Object.entries(killCounts).sort(
    ([, a], [, b]) => b - a
  )[0]

  const bestBomb = bombData
    .filter((b) => (b.damage_dealt ?? 0) > 0)
    .sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0))[0]

  return {
    topKiller: topKillerEntry
      ? { player: topKillerEntry[0], value: Number(topKillerEntry[1]) }
      : { player: '', value: 0 },
    bestBomber: bestBomb
      ? {
          player: resolveDisplayName(
            bestBomb.display_name ?? undefined,
            bestBomb.user_id ?? undefined,
            playerNameMap
          ),
          value: bestBomb.damage_dealt ?? 0
        }
      : { player: '', value: 0 }
  }
}

// Points: gold 3, silver 2, bronze 1, mostDamage 1, each side boss 2, biggest hit 1,
// season top killer 3, season best bomber 0.5.
export function calculatePlayerPoints(
  setWinners: RpcSetWinnerRow[],
  seasonResults: SeasonAwards
): PlayerPointSummary[] {
  const playerPoints: Record<string, PlayerPointSummary> = {}

  const ensure = (
    player: string | null | undefined
  ): PlayerPointSummary | null => {
    if (!player) return null
    if (!playerPoints[player]) {
      playerPoints[player] = {
        player,
        totalPoints: 0,
        goldMedals: 0,
        silverMedals: 0,
        bronzeMedals: 0
      }
    }
    return playerPoints[player]
  }

  setWinners.forEach((set) => {
    const gold = ensure(set.gold?.player)
    if (gold) {
      gold.totalPoints += 3
      gold.goldMedals += 1
    }
    const silver = ensure(set.silver?.player)
    if (silver) {
      silver.totalPoints += 2
      silver.silverMedals += 1
    }
    const bronze = ensure(set.bronze?.player)
    if (bronze) {
      bronze.totalPoints += 1
      bronze.bronzeMedals += 1
    }
    const mostDamage = ensure(set.mostDamage?.player)
    if (mostDamage) {
      mostDamage.totalPoints += 1
    }
    const sideBoss1 = ensure(set.sideBoss1?.player)
    if (sideBoss1) {
      sideBoss1.totalPoints += 2
    }
    const sideBoss2 = ensure(set.sideBoss2?.player)
    if (sideBoss2) {
      sideBoss2.totalPoints += 2
    }
    const biggestHit = ensure(set.biggestHit?.player)
    if (biggestHit) {
      biggestHit.totalPoints += 1
    }
  })

  const topKiller = ensure(seasonResults.topKiller.player)
  if (topKiller) {
    topKiller.totalPoints += 3
  }
  const bestBomber = ensure(seasonResults.bestBomber.player)
  if (bestBomber) {
    bestBomber.totalPoints += 0.5
  }

  return Object.values(playerPoints)
    .filter((p) => p.totalPoints > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints)
}
