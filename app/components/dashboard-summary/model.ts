import { rarityRank } from '@/app/lib/config'
import type {
  BossPerformanceSummary,
  LoopTokenEntry,
  LoopTokenSetData,
  PrimePerformanceSummary
} from './types'
import {
  ensureStringArray,
  isRecord,
  readRecordValue,
  toNumber,
  toRecord,
  toStringSafe
} from './coerce'

const sourceRecords = (value: unknown): Record<string, unknown>[] => {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value]
      : []
  return source.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object'
  )
}

const sortPerformance = <T extends { rarity: string; set?: number }>(
  rows: T[],
  encounterId: (row: T) => number,
  name: (row: T) => string
) =>
  rows
    .sort((left, right) => {
      const rarityDifference =
        rarityRank(right.rarity) - rarityRank(left.rarity)
      if (rarityDifference !== 0) return rarityDifference
      if (left.set !== right.set) return (right.set ?? 0) - (left.set ?? 0)
      const encounterDifference = encounterId(left) - encounterId(right)
      return encounterDifference || name(left).localeCompare(name(right))
    })
    .slice(0, 10)

export function buildBossPerformanceSummaries(
  performance: unknown,
  clusterComparison: unknown
): BossPerformanceSummary[] {
  const cluster = new Map<string, number>()
  sourceRecords(clusterComparison).forEach((record) => {
    const name = toStringSafe(record.boss_name ?? record.Name, '')
    if (!name) return
    cluster.set(
      `${toStringSafe(record.rarity, 'Legendary')}_${toNumber(record.set, 0)}_${name}_${toStringSafe(record.encounter_type, 'Boss')}`,
      toNumber(record.vs_cluster_percent, 0)
    )
  })

  const rows = sourceRecords(performance).flatMap((record) => {
    const encounterId = toNumber(record.encounterId, 0)
    if (encounterId !== 0) return []
    const boss = toStringSafe(record.bossName ?? record.Name, 'Unknown')
    const set = toNumber(record.set, Number.NaN)
    const rarity = toStringSafe(record.rarity, 'Legendary')
    const level = Number.isFinite(set) ? set + 1 : toNumber(record.tier, 5)
    return [
      {
        boss,
        tier: level,
        level,
        set: Number.isFinite(set) ? set : undefined,
        rarity,
        encounterId,
        avgDamage: toNumber(record.avgDamage, 0),
        maxDamage: toNumber(record.maxDamage, 0),
        hitCount: toNumber(record.hitCount, 0),
        vsClusterPercent:
          cluster.get(
            `${rarity}_${Number.isFinite(set) ? set : 0}_${boss}_Boss`
          ) ?? 0
      }
    ]
  })
  return sortPerformance(
    rows,
    (row) => row.encounterId,
    (row) => row.boss
  )
}

export function buildPrimePerformanceSummaries(
  performance: unknown,
  clusterComparison: unknown
): PrimePerformanceSummary[] {
  const cluster = new Map<string, number>()
  sourceRecords(clusterComparison).forEach((record) => {
    const name = toStringSafe(record.prime_name ?? record.Name, '')
    if (!name) return
    cluster.set(
      `${toStringSafe(record.rarity, 'Legendary')}_${toNumber(record.set, 0)}_${name}`,
      toNumber(record.vs_cluster_percent, 0)
    )
  })

  const rows = sourceRecords(performance).flatMap((record) => {
    const encounterId = toNumber(record.encounterId, 0)
    if (encounterId === 0) return []
    const prime = toStringSafe(record.primeName ?? record.Name, 'Unknown')
    const set = toNumber(record.set, Number.NaN)
    const rarity = toStringSafe(record.rarity, 'Legendary')
    const level = Number.isFinite(set) ? set + 1 : toNumber(record.tier, 5)
    return [
      {
        prime,
        level,
        set: Number.isFinite(set) ? set : undefined,
        rarity,
        encounterId,
        avgDamage: toNumber(record.avgDamage, 0),
        maxDamage: toNumber(record.maxDamage, 0),
        hitCount: toNumber(record.hitCount, 0),
        vsClusterPercent:
          cluster.get(`${rarity}_${Number.isFinite(set) ? set : 0}_${prime}`) ??
          0
      }
    ]
  })
  return sortPerformance(
    rows,
    (row) => row.encounterId,
    (row) => row.prime
  )
}

export interface DamageLoopModel {
  processed: Array<Record<string, unknown> & { loop: number }>
  bosses: string[]
  detailed: Array<{
    loop: number
    bossName: string
    avgDamage: number
    maxDamage: number
    totalDamage: number
    hitCount: number
    isPrime: boolean
  }>
  primeStatus: Map<string, boolean>
}

export function buildDamageLoopModel(value: unknown): DamageLoopModel {
  if (!value || typeof value !== 'object') {
    return { processed: [], bosses: [], detailed: [], primeStatus: new Map() }
  }
  const payload = value as {
    data?: unknown
    bosses?: unknown
    detailedData?: unknown
  }
  const data = Array.isArray(payload.data) ? payload.data : []
  const numericLoop = (entry: unknown) => {
    const numeric = typeof entry === 'number' ? entry : Number(entry)
    return Number.isFinite(numeric) ? numeric : 0
  }
  const loops = data
    .map((entry) => numericLoop((entry as Record<string, unknown>).loop))
    .sort((left, right) => left - right)
  const zeroBased = loops.includes(0)
  // The game API can send tier values that step by 2 (0,2,4,6).
  const skipping =
    loops.length >= 2 &&
    loops
      .slice(1)
      .every((loop, index) => loop === (loops[index] ?? Number.NaN) + 2)
  const processed = data.map((item) => {
    const entry = item as Record<string, unknown>
    const loop = numericLoop(entry.loop)
    return {
      ...entry,
      loop: skipping ? Math.floor(loop / 2) + 1 : zeroBased ? loop + 1 : loop
    }
  })
  const bosses = Array.isArray(payload.bosses)
    ? payload.bosses.map((boss) => toStringSafe(boss, '')).filter(Boolean)
    : []
  const detailed = Array.isArray(payload.detailedData)
    ? (payload.detailedData as DamageLoopModel['detailed'])
    : []
  return {
    processed,
    bosses,
    detailed,
    primeStatus: new Map(
      detailed.map((entry) => [entry.bossName, entry.isPrime])
    )
  }
}

function loopSource(value: unknown) {
  const map = value instanceof Map ? (value as Map<unknown, unknown>) : null
  const object = map ? null : toRecord(value)
  const keys = map ? Array.from(map.keys()) : object ? Object.keys(object) : []
  const indices = keys
    .map((key) => {
      const numeric = typeof key === 'number' ? key : Number(key)
      return Number.isFinite(numeric) ? numeric : Number.NaN
    })
    .filter((index) => Number.isFinite(index) && index >= 0)
  const record = (index: number) => {
    const candidate = map
      ? (map.get(index) ?? map.get(String(index)))
      : object?.[String(index)]
    return isRecord(candidate) ? candidate : null
  }
  return { map, object, indices, record }
}

function loopNumbering(indices: number[]) {
  return {
    zeroBased: indices.includes(0),
    skipping:
      indices.length >= 2 &&
      indices
        .slice(1)
        .every((loop, index) => loop === (indices[index] ?? Number.NaN) + 2)
  }
}

export function buildLoopTokenData(
  value: unknown,
  completedLoops: number
): LoopTokenEntry[] {
  if (!value || typeof value !== 'object') return []
  const source = loopSource(value)
  const maximum = Math.max(
    completedLoops,
    source.indices.length > 0 ? Math.max(...source.indices) : -1
  )
  const numbering = loopNumbering(source.indices)
  const rows: LoopTokenEntry[] = []
  for (let index = 0; index <= maximum; index++) {
    const record = source.record(index)
    const bossTokens = toNumber(readRecordValue(record, 'bosses'))
    const primeTokens = toNumber(readRecordValue(record, 'primes'))
    if (bossTokens + primeTokens <= 0) continue
    rows.push({
      loop: numbering.skipping
        ? Math.floor(index / 2) + 1
        : numbering.zeroBased
          ? index + 1
          : index,
      actualLoop: numbering.skipping
        ? Math.floor(index / 2)
        : numbering.zeroBased
          ? index
          : Math.max(index - 1, 0),
      bossTokens,
      primeTokens,
      totalTokens: bossTokens + primeTokens,
      rarities: ensureStringArray(readRecordValue(record, 'rarities'))
    })
  }
  return rows
}

export function buildDashboardLoopAggregates(
  damageRows: Array<Record<string, unknown> & { loop: number }>,
  bossNames: string[],
  primeStatus: Map<string, boolean>,
  tokens: LoopTokenEntry[]
) {
  const tokenLookup = new Map(
    tokens.map((token) => [token.actualLoop, token] as const)
  )
  // Keyed by loop so duplicate display loops collapse (last wins); otherwise Loop
  // Analysis duplicates the row and the trend compares it with its twin.
  const byLoop = new Map<number, ReturnType<typeof buildRow>[number]>()
  function buildRow(entry: Record<string, unknown> & { loop: number }) {
    const bosses = bossNames
      .map((name) => ({
        name,
        avgDamage: toNumber(entry[name], 0),
        isPrime: primeStatus.get(name) ?? false
      }))
      .filter((boss) => boss.avgDamage > 0)
      .sort((left, right) => right.avgDamage - left.avgDamage)
    if (bosses.length === 0) return []
    const totalAvgDamage = bosses.reduce(
      (total, boss) => total + boss.avgDamage,
      0
    )
    const token = tokenLookup.get(entry.loop)
    return [
      {
        loopIndex: entry.loop,
        bosses,
        totalAvgDamage,
        avgDamagePerBoss: totalAvgDamage / bosses.length,
        bossCount: bosses.length,
        bossTokens: token?.bossTokens ?? 0,
        primeTokens: token?.primeTokens ?? 0,
        totalTokens: token?.totalTokens ?? 0
      }
    ]
  }
  for (const entry of damageRows) {
    for (const row of buildRow(entry)) {
      byLoop.set(row.loopIndex, row)
    }
  }
  return [...byLoop.values()]
    .sort((left, right) => left.loopIndex - right.loopIndex)
    .map((loop, index, all) => {
      const previous = all[index - 1]
      const trend: 'improving' | 'declining' | 'stable' = !previous
        ? 'stable'
        : loop.avgDamagePerBoss > previous.avgDamagePerBoss * 1.05
          ? 'improving'
          : loop.avgDamagePerBoss < previous.avgDamagePerBoss * 0.95
            ? 'declining'
            : 'stable'
      return { ...loop, trend }
    })
}

export function buildLoopTokenDataBySet(
  value: unknown,
  completedLoops: number
): LoopTokenSetData | null {
  if (!value || typeof value !== 'object') return null
  const source = loopSource(value)
  const levelKeys = new Set<string>()
  const collect = (candidate: unknown) => {
    if (!isRecord(candidate)) return
    Object.keys(candidate).forEach((key) => {
      if (key !== 'total' && /^[LM]/.test(key)) levelKeys.add(key)
    })
  }
  if (source.map) source.map.forEach(collect)
  if (source.object) Object.values(source.object).forEach(collect)
  // L1 at bottom, M1 at top (Recharts stacks the first item at the bottom).
  const sortedKeys = [...levelKeys].sort((left, right) => {
    const order = (level: string) =>
      (level[0] === 'M' ? 100 : 0) + Number.parseInt(level.slice(1), 10)
    return order(left) - order(right)
  })
  const maximum = Math.max(
    completedLoops,
    source.indices.length > 0 ? Math.max(...source.indices) : -1
  )
  const numbering = loopNumbering(source.indices)
  const chartData: Array<Record<string, number | string>> = []
  for (let index = 0; index <= maximum; index++) {
    const record = source.record(index)
    const total = toNumber(readRecordValue(record, 'total'))
    if (total <= 0) continue
    const row: Record<string, number | string> = {
      lap: numbering.skipping
        ? Math.floor(index / 2) + 1
        : numbering.zeroBased
          ? index + 1
          : index,
      actualLoop: numbering.skipping
        ? Math.floor(index / 2)
        : numbering.zeroBased
          ? index
          : Math.max(index - 1, 0),
      total
    }
    sortedKeys.forEach((key) => {
      row[key] = toNumber(readRecordValue(record, key))
    })
    chartData.push(row)
  }
  return { chartData, levelKeys: sortedKeys }
}
