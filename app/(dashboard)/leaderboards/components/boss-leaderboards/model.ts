import { getBossDisplayName } from '@/app/lib/utils/bossNames'

export interface BossLeaderboardEntry {
  displayName: string
  userId: string | null
  Guild: string
  damageDealt: number
  tier: number
  set: number
  loopIndex: number
  encounterId: number
  completedOn: string
  heroDetails: string | null
  machineOfWarDetails: string | null
  Name: string
  rarity: string
  categories?: string[]
  /** Canonical player-level average against this encounter. */
  avgDamage?: number
  avgBattleCount?: number
}

export type BossLeaderboardTableRow = BossLeaderboardEntry & { rank: number }

export type RankBy = 'max' | 'avg'

export interface BossSummary {
  Name: string
  tier: number
  set: number
  rarity: string
  encounterId: number
}

export function toBossSummary(
  record: Record<string, unknown> | null | undefined
): BossSummary | null {
  if (!record) return null

  const name = typeof record.Name === 'string' ? record.Name.trim() : ''
  const rarity = typeof record.rarity === 'string' ? record.rarity.trim() : ''
  const setValue =
    typeof record.set === 'number' ? record.set : Number(record.set)
  const encounterIdValue =
    typeof record.encounterId === 'number'
      ? record.encounterId
      : Number(record.encounterId)
  const tierValue =
    typeof record.tier === 'number' ? record.tier : Number(record.tier)

  if (!name || !rarity) return null
  if (
    !Number.isFinite(setValue) ||
    !Number.isFinite(encounterIdValue) ||
    !Number.isFinite(tierValue)
  ) {
    return null
  }

  return {
    Name: name,
    rarity,
    set: setValue,
    encounterId: encounterIdValue,
    tier: tierValue
  }
}

export function getBossId(boss: BossSummary): string {
  return `${boss.rarity}-${boss.set}-${boss.encounterId}-${boss.Name}`
}

export function getEncounterDisplayName(
  bossName: string,
  encounterId: number
): string {
  if (encounterId === 0) return getBossDisplayName(bossName)
  if (encounterId === 1) return `${bossName} (Left Prime)`
  if (encounterId === 2) return `${bossName} (Right Prime)`
  return `${bossName} (Side ${encounterId})`
}

export function getLevelDisplay(set: number, rarity: string): string {
  const prefixMap: Record<string, string> = {
    Mythic: 'M',
    Legendary: 'L',
    Epic: 'E',
    Rare: 'R',
    Uncommon: 'U',
    Common: 'C'
  }
  const prefix = prefixMap[rarity] || rarity.charAt(0).toUpperCase()
  return `${prefix}${set + 1}`
}

export function groupBossesByLevel(
  bosses: BossSummary[]
): Record<string, BossSummary[]> {
  return bosses.reduce<Record<string, BossSummary[]>>((groups, boss) => {
    const level = getLevelDisplay(boss.set, boss.rarity)
    if (!groups[level]) groups[level] = []
    groups[level].push(boss)
    return groups
  }, {})
}

export function sortBossLevels(
  bossesByLevel: Record<string, BossSummary[]>
): string[] {
  return Object.keys(bossesByLevel).sort((a, b) => {
    const rarityOrder = ['M', 'L', 'E', 'R', 'U', 'C']
    const aOrder = rarityOrder.indexOf(a.charAt(0))
    const bOrder = rarityOrder.indexOf(b.charAt(0))
    if (aOrder !== bOrder) return aOrder - bOrder
    return Number.parseInt(b.slice(1), 10) - Number.parseInt(a.slice(1), 10)
  })
}

export function findSelectedBoss(
  bosses: BossSummary[],
  selectedBossId: string
): BossSummary | null {
  if (!selectedBossId) return null

  const [rarity, setText, encounterText, ...nameParts] =
    selectedBossId.split('-')
  if (!rarity || !setText || !encounterText) return null

  const set = Number.parseInt(setText, 10)
  const encounterId = Number.parseInt(encounterText, 10)
  if (Number.isNaN(set) || Number.isNaN(encounterId)) return null

  const name = nameParts.join('-')
  return (
    bosses.find(
      (boss) =>
        boss.rarity === rarity &&
        boss.set === set &&
        boss.encounterId === encounterId &&
        boss.Name === name
    ) ?? null
  )
}
