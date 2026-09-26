import type {
  BattleEntry,
  TokenUsagePlayer,
  PlayerPoints,
  SetWinner,
  SeasonResults
} from '@tacticus/app-core/votlw.types'
import { applyQualifyingSweepException } from '@/app/lib/calculations/utils/sweep-helpers'

interface PlayerBattleStats {
  totalDamage: number
  effectiveTokenCount: number
  battleTokenCount: number
  firstTokenTime?: string
  sweepCount: number
  oneShotCount: number
  bombCount: number
  crashCount: number
}

type PlayerStats = Record<string, PlayerBattleStats>

export type RawBattleEntry = BattleEntry & {
  [key: string]: unknown
}

// `offenders` is populated only when the guild opted in; empty means include everyone.
const includePlayer = (
  player: string | undefined | null,
  offenders: Set<string>
): boolean => {
  if (!player) return true
  return !offenders.has(player)
}

export const normalizeBattleEntry = (entry: RawBattleEntry): BattleEntry => {
  const getNumber = (keys: string[], fallback = 0): number => {
    for (const key of keys) {
      const value = entry[key as keyof RawBattleEntry]
      if (typeof value === 'number') {
        return value
      }
    }
    return fallback
  }

  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = entry[key as keyof RawBattleEntry]
      if (typeof value === 'string') {
        return value
      }
    }
    return undefined
  }

  return {
    Guild: getString(['Guild', 'guild', 'guild_code']) ?? '',
    Season: getString(['Season', 'season']) ?? '',
    displayName:
      getString(['displayName', 'display_name', 'player', 'player_name']) ??
      'Unknown',
    userId: getString(['userId', 'user_id']),
    Name: getString(['Name', 'boss_name', 'Boss', 'boss']) ?? '',
    damageDealt: getNumber(['damageDealt', 'damage_dealt', 'damage']),
    damageType:
      (entry.damageType as BattleEntry['damageType']) ??
      (entry.damage_type as BattleEntry['damageType']) ??
      'Battle',
    remainingHp: getNumber(['remainingHp', 'remaining_hp', 'enemyHpLeft']),
    maxHp: getNumber(['maxHp', 'max_hp']),
    tier: getNumber(['tier'], 0),
    set: (entry.set as BattleEntry['set']) ?? getNumber(['set_number']),
    loopIndex: getNumber(['loopIndex', 'loop_index']),
    encounterId: getNumber(
      ['encounterId', 'encounter_id', 'EncounterIndex'],
      0
    ),
    encounterIndex: getNumber([
      'encounterIndex',
      'encounter_index',
      'EncounterIndex'
    ]),
    rarity: getString(['rarity']) ?? 'Legendary',
    startedOn:
      getString(['startedOn', 'started_on', 'started']) ??
      new Date().toISOString(),
    completedOn:
      getString(['completedOn', 'completed_on', 'completed']) ??
      new Date().toISOString()
  }
}

const isLastHit = (entry: BattleEntry) => {
  return entry.damageType === 'Battle' && entry.remainingHp === 0
}

// Rarity index as `loopFromTier` expresses it (4 = Legendary, 5 = Mythic); null off the ladder.
const rarityRank = (rarity: string): number | null =>
  rarity === 'Legendary' ? 4 : rarity === 'Mythic' ? 5 : null

// Sweeps finish weakened bosses: excluded from averages, counted separately.
const isSweep = (entry: BattleEntry) => {
  return (
    entry.damageType === 'Battle' &&
    entry.remainingHp === 0 &&
    entry.maxHp > 0 &&
    entry.damageDealt < entry.maxHp
  )
}

// One-shots kill from full HP, so they DO count toward averages.
const isOneShot = (entry: BattleEntry) =>
  entry.damageType === 'Battle' &&
  entry.remainingHp === 0 &&
  typeof entry.maxHp === 'number' &&
  entry.maxHp > 0 &&
  (entry.damageDealt ?? 0) >= entry.maxHp

const isCrash = (entry: BattleEntry) => {
  return entry.damageType === 'Battle' && (entry.damageDealt ?? 0) <= 0
}

const calculateSeasonAwards = (
  lastHitData: BattleEntry[],
  bombData: BattleEntry[],
  allBattleData: BattleEntry[],
  offenders: Set<string>,
  mostImprovedOverride?: SeasonResults['mostImproved']
): SeasonResults => {
  const killerCounts: { [key: string]: number } = {}
  lastHitData?.forEach((hit) => {
    killerCounts[hit.displayName] = (killerCounts[hit.displayName] || 0) + 1
  })
  const killerEntries = Object.entries(killerCounts).sort((a, b) => b[1] - a[1])
  const topKillerEntry =
    killerEntries.find(([player]) => includePlayer(player, offenders)) ??
    killerEntries[0]

  const bombCandidates = (bombData ?? [])
    .filter((bomb) => bomb.damageDealt > 0)
    .sort((a, b) => b.damageDealt - a.damageDealt)
  const bestBomb =
    bombCandidates.find((bomb) => includePlayer(bomb.displayName, offenders)) ??
    bombCandidates[0]

  const worstBombCandidates = bombCandidates
    .slice()
    .sort((a, b) => a.damageDealt - b.damageDealt)
  const worstBombResult =
    worstBombCandidates.find((bomb) =>
      includePlayer(bomb.displayName, offenders)
    ) ?? worstBombCandidates[0]

  const nearKills = (allBattleData ?? [])
    .filter((battle) => battle.remainingHp > 0)
    .sort((a, b) => (a.remainingHp ?? 0) - (b.remainingHp ?? 0))
  const almostHadHimBattle =
    nearKills.find((battle) => includePlayer(battle.displayName, offenders)) ??
    nearKills[0]

  let firstToken = { player: '', time: '' }
  const sortedByTime = allBattleData
    .filter((b) => b.startedOn || b.completedOn)
    .sort((a, b) => {
      const timeA = new Date(a.startedOn || a.completedOn || '').getTime()
      const timeB = new Date(b.startedOn || b.completedOn || '').getTime()
      return timeA - timeB
    })
  const firstBattle = sortedByTime[0]
  if (firstBattle) {
    firstToken = {
      player: firstBattle.displayName,
      time: firstBattle.startedOn || firstBattle.completedOn || ''
    }
  }

  let lastToken = { player: '', time: '' }
  const lastBattle = sortedByTime[sortedByTime.length - 1]
  if (lastBattle) {
    lastToken = {
      player: lastBattle.displayName,
      time: lastBattle.startedOn || lastBattle.completedOn || ''
    }
  }

  const playerDamageStats: {
    [key: string]: { damage: number; tokens: number }
  } = {}
  allBattleData.forEach((b) => {
    const stats =
      playerDamageStats[b.displayName] ??
      (playerDamageStats[b.displayName] = { damage: 0, tokens: 0 })
    stats.damage += b.damageDealt
    stats.tokens += 1
  })

  const efficiencyRatios = Object.entries(playerDamageStats)
    .map(([player, stats]) => ({
      player,
      ratio: stats.tokens > 0 ? Math.round(stats.damage / stats.tokens) : 0
    }))
    .sort((a, b) => b.ratio - a.ratio)
  const tokenEfficiency = efficiencyRatios.find((entry) =>
    includePlayer(entry.player, offenders)
  ) ??
    efficiencyRatios[0] ?? { player: '', ratio: 0 }

  return {
    topKiller: topKillerEntry
      ? { player: topKillerEntry[0], value: topKillerEntry[1] }
      : undefined,
    bestBomber: bestBomb
      ? { player: bestBomb.displayName, value: bestBomb.damageDealt }
      : undefined,
    worstBomb: worstBombResult
      ? {
          player: worstBombResult.displayName,
          value: worstBombResult.damageDealt
        }
      : undefined,
    almostHadHim: almostHadHimBattle
      ? {
          player: almostHadHimBattle.displayName,
          boss: `L${(Number(almostHadHimBattle.set) || 0) + 1}`,
          hpLeft: almostHadHimBattle.remainingHp ?? 0
        }
      : undefined,
    firstToken,
    lastToken,
    tokenEfficiency,
    mostImproved: mostImprovedOverride ?? { player: '', improvementPct: 0 },
    mostDamage: { player: '', damage: 0 },
    bombMaster: { player: '', bombs: 0 },
    legendarySlayer: { player: '', kills: 0 },
    sideBossSlayer: { player: '', kills: 0 }
  }
}

// Set winners per boss level, mirroring the SQL RPC `get_votlw_set_winners`: looped bosses
// only, no crashes, sweep-free averages plus qualifying sweeps, 2+ meaningful battles to
// qualify. Baselines use every player; the offender filter applies only to winner selection.
export const calculateSetWinners = (
  battleData: BattleEntry[],
  offenders: Set<string>
): SetWinner[] => {
  // Crashes never count (SQL: `damageDealt > 0`).
  const nonCrashData = battleData.filter((d) => (d.damageDealt ?? 0) > 0)

  // Mirrors the RPC's `loop_start` CTE: the lowest (rarity, set) seen at
  // loopIndex >= 1 is the restart point; bosses below it are excluded.
  const loopStart = nonCrashData.reduce<{ rank: number; set: number } | null>(
    (lowest, entry) => {
      if (entry.damageType !== 'Battle') return lowest
      const rank = rarityRank(entry.rarity)
      if (rank === null || (entry.loopIndex ?? 0) < 1) return lowest
      const parsed =
        typeof entry.set === 'number' ? entry.set : parseInt(entry.set, 10)
      const point = { rank, set: Number.isFinite(parsed) ? parsed : 0 }
      if (!lowest) return point
      if (point.rank !== lowest.rank)
        return point.rank < lowest.rank ? point : lowest
      return point.set < lowest.set ? point : lowest
    },
    null
  )

  const setAwards = (
    rarity: 'Legendary' | 'Mythic',
    setNum: number
  ): boolean => {
    if (!loopStart) return true
    const rank = rarityRank(rarity)
    if (rank === null) return true
    return (
      rank > loopStart.rank ||
      (rank === loopStart.rank && setNum >= loopStart.set)
    )
  }

  const legendaryData = nonCrashData.filter((d) => d.rarity === 'Legendary')
  const mythicData = nonCrashData.filter((d) => d.rarity === 'Mythic')

  const results: SetWinner[] = []

  const toTime = (entry: BattleEntry): number =>
    new Date(entry.startedOn || entry.completedOn || '').getTime()

  interface AdjustedPlayer {
    player: string
    adjAvg: number | null
    adjCount: number
    totalDamage: number
    tokenCount: number
    firstTokenTime?: string
  }

  // Two-pass like the SQL RPC: sweep-free baseline over ALL players, then add each
  // player's sweeps with damage >= GREATEST(own non-sweep avg, baseline).
  const adjustPlayers = (rows: BattleEntry[]): AdjustedPlayer[] => {
    interface EncounterPlayerStats {
      nonSweepTotal: number
      nonSweepCount: number
      sweepDamages: number[]
      totalDamage: number
      tokenCount: number
      firstTokenTime?: string
    }

    const sorted = [...rows].sort((a, b) => toTime(a) - toTime(b))
    const perPlayer: { [key: string]: EncounterPlayerStats } = {}
    let baselineTotal = 0
    let baselineCount = 0

    sorted.forEach((d) => {
      const stats =
        perPlayer[d.displayName] ??
        (perPlayer[d.displayName] = {
          nonSweepTotal: 0,
          nonSweepCount: 0,
          sweepDamages: [],
          totalDamage: 0,
          tokenCount: 0,
          firstTokenTime: d.startedOn || d.completedOn || undefined
        })
      stats.totalDamage += d.damageDealt || 0
      stats.tokenCount += 1
      if (!isSweep(d) || isOneShot(d)) {
        stats.nonSweepTotal += d.damageDealt || 0
        stats.nonSweepCount += 1
        baselineTotal += d.damageDealt || 0
        baselineCount += 1
      } else {
        stats.sweepDamages.push(d.damageDealt || 0)
      }
    })

    const referenceAvg = baselineCount > 0 ? baselineTotal / baselineCount : 0

    return Object.entries(perPlayer).map(([player, stats]) => {
      const playerNonSweepAvg =
        stats.nonSweepCount > 0 ? stats.nonSweepTotal / stats.nonSweepCount : 0
      const { adjustedDamage, adjustedCount } = applyQualifyingSweepException(
        stats.nonSweepTotal,
        stats.nonSweepCount,
        stats.sweepDamages,
        referenceAvg,
        playerNonSweepAvg
      )
      return {
        player,
        adjAvg: adjustedCount > 0 ? adjustedDamage / adjustedCount : null,
        adjCount: adjustedCount,
        totalDamage: stats.totalDamage,
        tokenCount: stats.tokenCount,
        firstTokenTime: stats.firstTokenTime
      }
    })
  }

  const byAdjustedAvg = (a: AdjustedPlayer, b: AdjustedPlayer): number => {
    if ((b.adjAvg ?? 0) !== (a.adjAvg ?? 0)) {
      return (b.adjAvg ?? 0) - (a.adjAvg ?? 0)
    }
    // Tie-breakers: more meaningful battles, then earlier first token.
    if (b.adjCount !== a.adjCount) {
      return b.adjCount - a.adjCount
    }
    const timeA = a.firstTokenTime
      ? new Date(a.firstTokenTime).getTime()
      : Infinity
    const timeB = b.firstTokenTime
      ? new Date(b.firstTokenTime).getTime()
      : Infinity
    return timeA - timeB
  }

  const processRarity = (
    data: BattleEntry[],
    rarity: 'Legendary' | 'Mythic',
    prefix: string
  ) => {
    const sets = [0, 1, 2, 3, 4]
    sets.forEach((setNum) => {
      // Single-pass bosses emit no row, matching the RPC.
      if (!setAwards(rarity, setNum)) {
        return
      }

      const setData = data.filter(
        (d) =>
          (typeof d.set === 'number' ? d.set : parseInt(d.set as string)) ===
            setNum && d.encounterId === 0 // Main boss only for most calculations
      )

      if (setData.length === 0) {
        results.push({
          set: setNum,
          rarity,
          levelString: `${prefix}${setNum + 1}`,
          bossName: 'Unknown Boss',
          gold: '',
          goldValue: 0,
          silver: '',
          silverValue: 0,
          bronze: '',
          bronzeValue: 0,
          mostDamage: '',
          mostDamageValue: 0,
          sideBoss1: '',
          sideBoss1Value: 0,
          sideBoss2: '',
          sideBoss2Value: 0,
          biggestHit: '',
          biggestHitValue: 0
        })
        return
      }

      const bossName = setData[0]?.Name || 'Unknown Boss'

      const adjustedMainPlayers = adjustPlayers(setData)

      // Medals need 2+ meaningful battles (non-sweeps plus qualifying sweeps).
      const qualifiedPlayers = adjustedMainPlayers
        .filter(
          (entry) =>
            entry.adjCount > 1 &&
            entry.adjAvg !== null &&
            includePlayer(entry.player, offenders)
        )
        .sort(byAdjustedAvg)

      // SQL parity: no medal qualifiers means no awards for the set at all.
      if (qualifiedPlayers.length === 0) {
        results.push({
          set: setNum,
          rarity,
          levelString: `${prefix}${setNum + 1}`,
          bossName,
          gold: '',
          goldValue: 0,
          silver: '',
          silverValue: 0,
          bronze: '',
          bronzeValue: 0,
          mostDamage: '',
          mostDamageValue: 0,
          sideBoss1: '',
          sideBoss1Value: 0,
          sideBoss2: '',
          sideBoss2Value: 0,
          biggestHit: '',
          biggestHitValue: 0
        })
        return
      }

      // Total damage winners: all players, sweeps included (SQL `total_damage_ranked`).
      const totalDamageWinners = adjustedMainPlayers
        .filter((entry) => includePlayer(entry.player, offenders))
        .sort((a, b) => {
          if (b.totalDamage !== a.totalDamage) {
            return b.totalDamage - a.totalDamage
          }
          // Tie-breakers: more tokens, then earlier first token.
          if (b.tokenCount !== a.tokenCount) {
            return b.tokenCount - a.tokenCount
          }
          const timeA = a.firstTokenTime
            ? new Date(a.firstTokenTime).getTime()
            : Infinity
          const timeB = b.firstTokenTime
            ? new Date(b.firstTokenTime).getTime()
            : Infinity
          return timeA - timeB
        })

      const getEncounterIndex = (entry: BattleEntry): number | null => {
        if (typeof entry.encounterIndex === 'number') {
          return entry.encounterIndex
        }
        if (typeof entry.encounterId === 'number') {
          return entry.encounterId
        }
        return null
      }

      const sideBoss1Data = data.filter((d) => {
        const setNumber =
          typeof d.set === 'number' ? d.set : parseInt(d.set as string)
        const encounterValue = getEncounterIndex(d)
        return setNumber === setNum && encounterValue === 1
      })

      const sideBoss2Data = data.filter((d) => {
        const setNumber =
          typeof d.set === 'number' ? d.set : parseInt(d.set as string)
        const encounterValue = getEncounterIndex(d)
        return setNumber === setNum && encounterValue === 2
      })

      const getSideBossWinner = (sideBossData: BattleEntry[]) =>
        adjustPlayers(sideBossData)
          .filter(
            (entry) =>
              entry.adjCount > 1 &&
              entry.adjAvg !== null &&
              includePlayer(entry.player, offenders)
          )
          .sort(byAdjustedAvg)[0]

      const sideBoss1Winner = getSideBossWinner(sideBoss1Data)
      const sideBoss2Winner = getSideBossWinner(sideBoss2Data)

      // SQL parity: Most Damage joins through qualified_avg, so it is blank unless the
      // top-total player is medal-qualified (no fall-through to the next player).
      const topTotalPlayer = totalDamageWinners[0]
      const mostDamageWinner =
        topTotalPlayer &&
        qualifiedPlayers.some((q) => q.player === topTotalPlayer.player)
          ? topTotalPlayer
          : undefined

      // Earliest hit wins ties (SQL `ORDER BY damage_dealt DESC, started_on ASC`).
      const biggestHit = [...setData]
        .sort((a, b) => toTime(a) - toTime(b))
        .filter((d) => includePlayer(d.displayName, offenders))
        .reduce(
          (max, d) =>
            d.damageDealt > max.damage
              ? { player: d.displayName, damage: d.damageDealt }
              : max,
          { player: '', damage: 0 }
        )

      results.push({
        set: setNum,
        rarity,
        levelString: `${prefix}${setNum + 1}`,
        bossName,
        gold: qualifiedPlayers[0]?.player || '',
        goldValue: Math.round(qualifiedPlayers[0]?.adjAvg ?? 0),
        silver: qualifiedPlayers[1]?.player || '',
        silverValue: Math.round(qualifiedPlayers[1]?.adjAvg ?? 0),
        bronze: qualifiedPlayers[2]?.player || '',
        bronzeValue: Math.round(qualifiedPlayers[2]?.adjAvg ?? 0),
        mostDamage: mostDamageWinner?.player || '',
        mostDamageValue: mostDamageWinner?.totalDamage || 0,
        sideBoss1: sideBoss1Winner?.player || '',
        sideBoss1Value: Math.round(sideBoss1Winner?.adjAvg ?? 0),
        sideBoss2: sideBoss2Winner?.player || '',
        sideBoss2Value: Math.round(sideBoss2Winner?.adjAvg ?? 0),
        biggestHit: biggestHit.player,
        biggestHitValue: biggestHit.damage
      })
    })
  }

  processRarity(legendaryData, 'Legendary', 'L')

  processRarity(mythicData, 'Mythic', 'M')

  return results
}

export const calculatePlayerPointsFromAwards = (
  setResults: SetWinner[],
  seasonResults: SeasonResults | null,
  playerStats: PlayerStats
): PlayerPoints[] => {
  const playerPoints: {
    [key: string]: PlayerPoints & { firstTokenTime?: string }
  } = {}

  const allPlayers = new Set<string>()
  setResults.forEach((set) => {
    ;[
      set.gold,
      set.silver,
      set.bronze,
      set.mostDamage,
      set.sideBoss1,
      set.sideBoss2,
      set.biggestHit
    ]
      .filter(Boolean)
      .forEach((player) => allPlayers.add(player))
  })
  if (seasonResults?.topKiller?.player)
    allPlayers.add(seasonResults.topKiller.player)
  if (seasonResults?.bestBomber?.player)
    allPlayers.add(seasonResults.bestBomber.player)

  allPlayers.forEach((player) => {
    playerPoints[player] = {
      displayName: player,
      totalPoints: 0,
      avgDamagePerHit: 0,
      tokenCount: 0,
      sweeps: 0,
      oneShots: 0,
      bombsUsed: 0,
      crashes: 0,
      awards: {
        goldMedals: 0,
        silverMedals: 0,
        bronzeMedals: 0,
        mostDamageAwards: 0,
        sideBossWins: 0,
        biggestHitAwards: 0,
        topKiller: false,
        bestBomber: false,
        sideBoss1Wins: 0,
        sideBoss2Wins: 0
      },
      breakdown: []
    }
  })

  const applyAward = (
    playerName: string | undefined,
    updater: (points: PlayerPoints & { firstTokenTime?: string }) => void
  ) => {
    if (!playerName) {
      return
    }
    const points = playerPoints[playerName]
    if (!points) {
      return
    }
    updater(points)
  }

  setResults.forEach((set) => {
    const setName = set.levelString

    applyAward(set.gold, (points) => {
      points.totalPoints += 3
      points.awards.goldMedals += 1
      points.breakdown.push(`${setName} Gold (3pts)`)
    })

    applyAward(set.silver, (points) => {
      points.totalPoints += 2
      points.awards.silverMedals += 1
      points.breakdown.push(`${setName} Silver (2pts)`)
    })

    applyAward(set.bronze, (points) => {
      points.totalPoints += 1
      points.awards.bronzeMedals += 1
      points.breakdown.push(`${setName} Bronze (1pt)`)
    })

    applyAward(set.mostDamage, (points) => {
      points.totalPoints += 1
      points.awards.mostDamageAwards += 1
      points.breakdown.push(`${setName} Most Damage (1pt)`)
    })

    applyAward(set.sideBoss1, (points) => {
      points.totalPoints += 2
      points.awards.sideBoss1Wins! += 1
      points.breakdown.push(`${setName} Side Boss 1 (2pts)`)
    })

    applyAward(set.sideBoss2, (points) => {
      points.totalPoints += 2
      points.awards.sideBoss2Wins! += 1
      points.breakdown.push(`${setName} Side Boss 2 (2pts)`)
    })

    applyAward(set.biggestHit, (points) => {
      points.totalPoints += 1
      points.awards.biggestHitAwards += 1
      points.breakdown.push(`${setName} Biggest Hit (1pt)`)
    })
  })

  applyAward(seasonResults?.topKiller?.player, (points) => {
    points.totalPoints += 3
    points.awards.topKiller = true
    points.breakdown.push('Top Killer (3pts)')
  })

  applyAward(seasonResults?.bestBomber?.player, (points) => {
    points.totalPoints += 0.5
    points.awards.bestBomber = true
    points.breakdown.push('Best Bomber (0.5pts)')
  })

  Object.keys(playerPoints).forEach((player) => {
    const stats = playerStats[player]
    const points = playerPoints[player]
    if (stats && points) {
      points.avgDamagePerHit =
        stats.effectiveTokenCount > 0
          ? Math.round(stats.totalDamage / stats.effectiveTokenCount)
          : 0
      points.tokenCount = stats.battleTokenCount
      points.sweeps = stats.sweepCount
      points.oneShots = stats.oneShotCount
      points.bombsUsed = stats.bombCount
      points.crashes = stats.crashCount
      points.firstTokenTime = stats.firstTokenTime
    }
  })

  // Tie-breakers: token count, then earlier first token.
  const sortedPlayers = Object.values(playerPoints).sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints
    }
    if (b.tokenCount !== a.tokenCount) {
      return b.tokenCount - a.tokenCount
    }
    const timeA = a.firstTokenTime
      ? new Date(a.firstTokenTime).getTime()
      : Infinity
    const timeB = b.firstTokenTime
      ? new Date(b.firstTokenTime).getTime()
      : Infinity
    return timeA - timeB
  })

  return sortedPlayers
}

export async function calculateVOTLWPoints(
  allBattleData: BattleEntry[],
  bombData: BattleEntry[],
  offenders: Set<string>,
  tokenUsageData: TokenUsagePlayer[],
  guild: string,
  season: string,
  clusterCode?: string | null,
  options?: {
    setWinnersOverride?: SetWinner[]
    seasonAwardsOverride?: SeasonResults | null
    mostImprovedOverride?: SeasonResults['mostImproved']
  }
): Promise<{
  playerPoints: PlayerPoints[]
  setWinners: SetWinner[]
  seasonAwards: SeasonResults
}> {
  void tokenUsageData
  void guild
  void season
  void clusterCode
  const normalizedBattleData = allBattleData.map((entry) =>
    normalizeBattleEntry(entry as RawBattleEntry)
  )
  const normalizedBombData = bombData.map((entry) =>
    normalizeBattleEntry(entry as RawBattleEntry)
  )

  const lastHitData = normalizedBattleData.filter((entry) => isLastHit(entry))
  const battleData = [...normalizedBattleData] // include last hits so one-shots stay in champion stats

  const seasonAwards =
    options?.seasonAwardsOverride ??
    calculateSeasonAwards(
      lastHitData,
      normalizedBombData,
      normalizedBattleData,
      offenders,
      options?.mostImprovedOverride
    )

  const setWinners =
    options?.setWinnersOverride ?? calculateSetWinners(battleData, offenders)

  const playerStats: PlayerStats = {}

  const ensurePlayerStats = (
    player: string,
    firstTokenTime?: string
  ): PlayerBattleStats => {
    if (!playerStats[player]) {
      playerStats[player] = {
        totalDamage: 0,
        effectiveTokenCount: 0,
        battleTokenCount: 0,
        firstTokenTime,
        sweepCount: 0,
        oneShotCount: 0,
        bombCount: 0,
        crashCount: 0
      }
    } else if (!playerStats[player].firstTokenTime && firstTokenTime) {
      playerStats[player].firstTokenTime = firstTokenTime
    }
    return playerStats[player]
  }

  // Sorted by startedOn to find each player's first token.
  const sortedByTime = [...normalizedBattleData].sort((a, b) => {
    const timeA = new Date(a.startedOn || a.completedOn || '').getTime()
    const timeB = new Date(b.startedOn || b.completedOn || '').getTime()
    return timeA - timeB
  })

  sortedByTime.forEach((entry) => {
    if (!entry.displayName) {
      return
    }
    const stats = ensurePlayerStats(
      entry.displayName,
      entry.startedOn || entry.completedOn || undefined
    )

    stats.battleTokenCount += 1

    if (isCrash(entry)) {
      stats.crashCount += 1
      return
    }

    const treatAsSweep = isSweep(entry) && !isOneShot(entry)
    if (treatAsSweep) {
      stats.sweepCount += 1
    } else {
      stats.totalDamage += entry.damageDealt || 0
      stats.effectiveTokenCount += 1
    }

    if (isOneShot(entry)) {
      stats.oneShotCount += 1
    }
  })

  normalizedBombData?.forEach((entry) => {
    if (!entry.displayName) return
    const stats = ensurePlayerStats(entry.displayName)
    stats.bombCount += 1
  })

  const playerPoints = calculatePlayerPointsFromAwards(
    setWinners,
    seasonAwards,
    playerStats
  )

  return {
    playerPoints,
    setWinners,
    seasonAwards
  }
}
