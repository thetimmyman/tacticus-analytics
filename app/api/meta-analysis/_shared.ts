export const DEFAULT_META_ANALYSIS_RARITIES = ['Legendary', 'Mythic'] as const

export type MetaAnalysisBossType = 'main' | 'side-left' | 'side-right'

export interface MetaAnalysisBossRecord {
  rarity?: string | null
  set?: number | null
  Name?: string | null
  encounterId?: number | null
  /** See app/lib/boss-assignments/loop-window.ts. */
  loopIndex?: number | null
  Guild?: string | null
}

export interface MetaAnalysisBossLevel {
  rarity: string
  set: number
  encounterId: number
  bossType: MetaAnalysisBossType
}

export function parseMetaAnalysisRarities(
  rarityParam: string | null | undefined,
  options: { trim: boolean } = { trim: true }
): string[] {
  if (!rarityParam) return [...DEFAULT_META_ANALYSIS_RARITIES]
  const values = rarityParam.split(',')
  return options.trim ? values.map((rarity) => rarity.trim()) : values
}

export function buildMetaBossNameKey(
  rarity: string,
  set: number,
  encounterId: number | string | null | undefined
): string {
  return encounterId === 0
    ? `${rarity}-${set}`
    : `${rarity}-${set}-side${encounterId}`
}

export function buildMetaBossNameMap(
  bosses: MetaAnalysisBossRecord[] | null | undefined
): Record<string, string> {
  const uniqueBosses = new Map<string, string>()

  bosses?.forEach((boss) => {
    if (
      !boss.Name ||
      !boss.rarity ||
      boss.set === null ||
      boss.set === undefined
    ) {
      return
    }

    if (boss.encounterId === 0 || (boss.encounterId ?? 0) > 0) {
      const key = buildMetaBossNameKey(boss.rarity, boss.set, boss.encounterId)
      if (!uniqueBosses.has(key)) {
        uniqueBosses.set(key, boss.Name)
      }
    }
  })

  return Object.fromEntries(uniqueBosses)
}

export function getMetaAnalysisBossType(
  encounterId: number | null | undefined
): MetaAnalysisBossType {
  return encounterId === 0
    ? 'main'
    : encounterId === 1
      ? 'side-left'
      : 'side-right'
}

export function buildMetaAnalysisBossLevels(
  bosses: MetaAnalysisBossRecord[] | null | undefined
): {
  bossLevels: MetaAnalysisBossLevel[]
  bossNames: Record<string, string>
} {
  const bossLevelsSet = new Set<string>()
  const bossLevels: MetaAnalysisBossLevel[] = []
  const bossNames: Record<string, string> = {}

  bosses?.forEach((record) => {
    if (!record.rarity || record.set === null || record.set === undefined) {
      return
    }

    const encounterId = record.encounterId || 0
    const key = `${record.rarity}-${record.set}-${encounterId}`
    if (bossLevelsSet.has(key)) return

    bossLevelsSet.add(key)
    bossLevels.push({
      rarity: record.rarity,
      set: record.set,
      encounterId,
      bossType: getMetaAnalysisBossType(record.encounterId)
    })

    if (record.Name) {
      bossNames[
        buildMetaBossNameKey(record.rarity, record.set, record.encounterId)
      ] = record.Name
    }
  })

  if (bossLevels.length === 0) {
    for (let set = 0; set <= 4; set++) {
      bossLevels.push({
        rarity: 'Legendary',
        set,
        encounterId: 0,
        bossType: 'main'
      })
    }
  }

  return { bossLevels, bossNames }
}
