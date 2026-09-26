import { logger } from '../_shared/logger.ts'

export interface LeaderboardBattleRow {
  cluster_code?: string | null
  Guild?: string | null
  set?: number | string | null
  rarity?: string | null
  heroDetails?: string | null
  machineOfWarDetails?: string | null
  userId?: string | null
  displayName?: string | null
  damageDealt: number
  type?: string | null
  Name?: string | null
  encounterIndex?: number | string | null
}

export type ProcessedBattle = Omit<LeaderboardBattleRow, 'encounterIndex'> & {
  bossCode: string
  position: string
  encounterIndex: number
  teamHash: string
}

type EmojiMap = ReadonlyMap<string, string>

export { formatTimestamp as formatLeaderboardTimestamp } from '../_shared/formatters.ts'

export function createTeamHash(
  heroDetails: string | null | undefined,
  machineOfWarDetails: string | null | undefined
) {
  let heroString = 'null'
  if (heroDetails) {
    try {
      const heroes = JSON.parse(heroDetails)
      if (Array.isArray(heroes)) {
        heroString = heroes
          .map((hero) => hero.unitId || hero.name || '')
          .filter(Boolean)
          .sort()
          .join(',')
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.warn(
        `[update-discord-leaderboards] Failed to parse heroDetails JSON: ${reason}`
      )
    }
  }

  let mowString = 'null'
  if (machineOfWarDetails) {
    try {
      const mow = JSON.parse(machineOfWarDetails)
      mowString = mow.unitId || mow.name || 'null'
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.warn(
        `[update-discord-leaderboards] Failed to parse machineOfWarDetails JSON: ${reason}`
      )
    }
  }
  return `heroes:${heroString}_mow:${mowString}`
}

export function formatTeam(
  heroDetails: string | null | undefined,
  machineOfWarDetails: string | null | undefined,
  emojiMap: EmojiMap
) {
  const teamParts: string[] = []
  if (heroDetails) {
    try {
      const heroes = JSON.parse(heroDetails)
      if (Array.isArray(heroes)) {
        const heroEmojis = heroes
          .sort((a, b) => {
            const aId = a.unitId || a.name || ''
            const bId = b.unitId || b.name || ''
            return aId.localeCompare(bId)
          })
          .map((hero) => {
            const id = hero.unitId || hero.name
            return emojiMap.get(id) || id
          })
          .filter(Boolean)
        if (heroEmojis.length > 0) teamParts.push(heroEmojis.join(' '))
      }
    } catch (error) {
      logger.error('Error parsing heroes:', error)
    }
  }

  try {
    if (machineOfWarDetails) {
      const mow = JSON.parse(machineOfWarDetails)
      const mowId = mow.unitId || mow.name
      const mowEmoji = emojiMap.get(mowId) || mowId
      if (mowEmoji) teamParts.push(mowEmoji)
    }
  } catch (error) {
    logger.error('Error parsing MOW:', error)
  }
  return teamParts.length > 0 ? teamParts.join(' & ') : 'No team data'
}

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function groupBattlesByBoss(
  battles: LeaderboardBattleRow[],
  guildFilter: string | null = null,
  clusterCode: string | null = null
) {
  const bossBattles = new Map<string, Map<string, ProcessedBattle>>()
  let filteredBattles = battles
  if (clusterCode !== null && clusterCode !== undefined) {
    filteredBattles = filteredBattles.filter(
      (battle) => battle.cluster_code === clusterCode
    )
  } else if (clusterCode === null) {
    // Independent guilds: battles without a cluster_code.
    filteredBattles = filteredBattles.filter(
      (battle) => !battle.cluster_code || battle.cluster_code === null
    )
  }
  if (guildFilter) {
    filteredBattles = filteredBattles.filter(
      (battle) => battle.Guild === guildFilter
    )
  }

  for (const entry of filteredBattles) {
    const setNum = parseInt(String(entry.set)) || 0
    const encounterIndex = parseInt(String(entry.encounterIndex)) || 0
    const bossCode = `${entry.rarity === 'Mythic' ? 'M' : 'L'}${setNum + 1}`
    const position = encounterIndex === 0 ? 'Main' : `Prime${encounterIndex}`
    const bossKey = `${bossCode}_${position}`
    // Key on userId so a renamed player stays one entry.
    const teamHash = createTeamHash(
      entry.heroDetails,
      entry.machineOfWarDetails
    )
    const stablePlayerId =
      entry.userId ??
      `${(entry.Guild || '').trim().toUpperCase()}::${(entry.displayName || '').trim().toLowerCase()}`
    const uniqueKey = `${stablePlayerId}_${teamHash}`
    if (!bossBattles.has(bossKey)) bossBattles.set(bossKey, new Map())
    const battleMap = bossBattles.get(bossKey)!
    if (
      !battleMap.has(uniqueKey) ||
      battleMap.get(uniqueKey)!.damageDealt < entry.damageDealt
    ) {
      battleMap.set(uniqueKey, {
        ...entry,
        bossCode,
        position,
        encounterIndex,
        teamHash
      })
    }
  }
  return bossBattles
}

export function getSortedBossKeys(
  bossBattles: Map<string, Map<string, ProcessedBattle>>
) {
  return Array.from(bossBattles.keys()).sort((a, b) => {
    const [aCode, aPos] = a.split('_')
    const [bCode, bPos] = b.split('_')
    const aPrefix = aCode.charAt(0)
    const bPrefix = bCode.charAt(0)
    const aLevelNum = parseInt(aCode.substring(1))
    const bLevelNum = parseInt(bCode.substring(1))
    if (aPrefix !== bPrefix) return aPrefix === 'L' ? -1 : 1
    if (aLevelNum !== bLevelNum) return aLevelNum - bLevelNum
    const positionOrder: Record<string, number> = {
      Main: 0,
      Prime1: 1,
      Prime2: 2
    }
    return (positionOrder[aPos] ?? 999) - (positionOrder[bPos] ?? 999)
  })
}
