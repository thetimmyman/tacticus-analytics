import {
  toStringValue,
  toNumberValue,
  processTimestamp,
  processSetValue,
  serializeDetails,
  truncateIsoToWholeSecond
} from './helpers.ts'
import {
  isErasureTombstone,
  isUidLikeName
} from '../player-name-resolution-core.ts'

export type RaidEntry = {
  userId?: string
  // Real per-entry name, but may be an upstream Player#XXXXXX privacy alias.
  username?: string
  type?: string
  unitId?: string
  encounterIndex?: number | string
  encounterType?: string
  tier?: number | string
  maxHp?: number | string
  rarity?: string
  remainingHp?: number | string
  damageDealt?: number | string
  set?: number | string
  damageType?: string
  startedOn?: number | string
  completedOn?: number | string
  heroDetails?: unknown
  machineOfWarDetails?: unknown
  globalConfigHash?: string
  position?: string
  raidBossId?: string
  Name?: string
  [key: string]: unknown
}

export interface ProcessedRaidEntry {
  Guild: string
  Season: string
  displayName: string
  Name: string
  maxHp: number
  remainingHp: number
  damageDealt: number
  loopIndex: number
  tier: number
  set: number
  encounterId: number
  damageType: string
  startedOn: string
  completedOn: string
  timestamp: string
  rarity: string
  userId: string
  encounterIndex: number
  encounterType: string
  type: string
  unitId: string
  globalConfigHash: string
  heroDetails: string | null
  machineOfWarDetails: string | null
  cluster_code: string | null
  cluster_id: string | null
}

export type PlayerMappings = Record<string, string>
export type BossMappings = Record<string, Record<number, string>>
export type SanitizedEntriesResult = {
  sanitized: RaidEntry[]
  dropped: number
}

const isFiniteEncounterIndex = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0 && value <= 1000

export function sanitizeRaidEntries(
  rawEntries: unknown[],
  logger?: { warn: (message: string, meta?: Record<string, unknown>) => void },
  context?: { correlationId?: string }
): SanitizedEntriesResult {
  const sanitized: RaidEntry[] = []
  let dropped = 0

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') {
      dropped++
      logger?.warn('tacticus:entry:invalid_shape', {
        correlationId: context?.correlationId
      })
      continue
    }

    const entry = raw as RaidEntry
    const userId = typeof entry.userId === 'string' ? entry.userId.trim() : ''
    const encounterIndex = toNumberValue(entry.encounterIndex)

    if (!userId) {
      dropped++
      logger?.warn('tacticus:entry:missing_userId', {
        correlationId: context?.correlationId,
        entry: { type: entry.type, unitId: entry.unitId }
      })
      continue
    }

    if (!isFiniteEncounterIndex(encounterIndex)) {
      dropped++
      logger?.warn('tacticus:entry:invalid_encounterIndex', {
        correlationId: context?.correlationId,
        entry: { userId, encounterIndex: entry.encounterIndex }
      })
      continue
    }

    sanitized.push({ ...entry, userId, encounterIndex })
  }

  return { sanitized, dropped }
}

export function validateDataTypes(
  entry: ProcessedRaidEntry,
  guildCode: string,
  logger?: { debug: (ctx: string, msg: string) => void }
): boolean {
  const errors = []
  if (!entry.Guild || typeof entry.Guild !== 'string') {
    errors.push('Guild must be a non-empty string')
  }
  if (!entry.Season || typeof entry.Season !== 'string') {
    errors.push('Season must be a non-empty string')
  }
  if (!entry.userId || typeof entry.userId !== 'string') {
    errors.push('userId must be a non-empty string')
  }
  if (!entry.Name || typeof entry.Name !== 'string') {
    errors.push('Name must be a non-empty string')
  }
  if (!Number.isFinite(entry.damageDealt)) {
    errors.push('damageDealt must be finite')
  }
  if (!Number.isFinite(entry.maxHp)) {
    errors.push('maxHp must be finite')
  }
  if (!Number.isFinite(entry.remainingHp)) {
    errors.push('remainingHp must be finite')
  }
  if (
    typeof entry.encounterId !== 'number' ||
    !Number.isFinite(entry.encounterId)
  ) {
    errors.push('encounterId must be a finite number')
  }
  if (errors.length > 0 && logger) {
    logger.debug(guildCode, `Validation errors: ${errors.join(', ')}`)
  }
  return errors.length === 0
}

export function processRaidEntry(
  entry: RaidEntry,
  guildCode: string,
  season: number,
  playerMappings: PlayerMappings,
  bossMappings: BossMappings,
  clusterCode: string | null,
  clusterId: string | null,
  logger?: { error: (ctx: string, msg: string) => void },
  // Last known names of departed members; consulted last.
  departedMappings?: PlayerMappings
): ProcessedRaidEntry | null {
  if (clusterCode === 'null' || clusterCode === 'undefined') {
    clusterCode = null
    clusterId = null
  }

  const userId = toStringValue(entry.userId, '').trim()
  if (!userId) {
    logger?.error(guildCode, 'Missing userId for raid entry')
    return null
  }
  const rawUsername = toStringValue(entry.username, '').trim()
  const shortId = userId.replace(/-/g, '').substring(0, 6).toUpperCase()
  let displayName = 'Unknown'

  // Resolution order: userId, lowercase userId, a non-alias username, a departed member's last name,
  // then a synthesized Player#XXXXXX (never a raw UUID).
  const departedName =
    departedMappings?.[userId] || departedMappings?.[userId.toLowerCase()]
  if (userId && playerMappings[userId]) {
    displayName = playerMappings[userId]
  } else if (userId && playerMappings[userId.toLowerCase()]) {
    displayName = playerMappings[userId.toLowerCase()]
  } else if (
    rawUsername &&
    !isUidLikeName(rawUsername) &&
    // A tombstone-shaped upstream name is never promoted to an identity.
    !isErasureTombstone(rawUsername)
  ) {
    displayName = rawUsername
  } else if (departedName) {
    displayName = departedName
  } else if (userId) {
    displayName = `Player#${shortId}`
  }

  const encounterIndexValue = toNumberValue(entry.encounterIndex)
  if (encounterIndexValue === null) {
    logger?.error(
      guildCode,
      `Invalid encounterIndex for entry: ${JSON.stringify({ userId: entry.userId, type: entry.type, encounterIndex: entry.encounterIndex })}`
    )
    return null
  }
  const encounterIndex = Math.trunc(encounterIndexValue)

  let bossName = 'Unknown'
  if (encounterIndex === 0) {
    bossName = toStringValue(entry.type, 'Unknown') || 'Unknown'
  } else if (encounterIndex > 0 && entry.type) {
    const typeKey = String(entry.type)
    if (bossMappings[typeKey]?.[encounterIndex]) {
      bossName = bossMappings[typeKey][encounterIndex]
    } else {
      bossName = `${typeKey} Prime ${encounterIndex}`
    }
  }

  const tier = Math.max(0, Math.trunc(toNumberValue(entry.tier) ?? 0))
  const enemyHp = Math.max(0, Math.trunc(toNumberValue(entry.maxHp) ?? 0))

  let rarity: string
  if (enemyHp === 30000000 || enemyHp === 2400000) {
    rarity = 'Mythic'
  } else {
    rarity = toStringValue(entry.rarity, 'Unknown')
  }

  const loopIndex = tier >= 4 ? Math.floor((tier - 4) / 2) : 0

  return {
    Guild: String(guildCode),
    Season: String(season),
    // Never fall back to the raw userId.
    displayName: String(displayName).trim() || `Player#${shortId}`,
    Name: String(bossName),
    maxHp: enemyHp,
    remainingHp: Math.max(0, Math.trunc(toNumberValue(entry.remainingHp) ?? 0)),
    damageDealt: Math.max(0, Math.trunc(toNumberValue(entry.damageDealt) ?? 0)),
    loopIndex: loopIndex,
    tier: tier,
    set: processSetValue(entry.set),
    encounterId: encounterIndex,
    damageType: toStringValue(entry.damageType, 'Battle') || 'Battle',
    // Matches app/lib/sync/transformers.ts so both writers produce the same unique_battle_record_complete key.
    startedOn: truncateIsoToWholeSecond(
      processTimestamp(entry.startedOn ?? entry.timestamp)
    )!,
    completedOn: truncateIsoToWholeSecond(
      processTimestamp(entry.completedOn ?? entry.timestamp)
    )!,
    timestamp: new Date().toISOString(),
    rarity: rarity,
    userId: userId,
    encounterIndex: encounterIndex,
    encounterType: toStringValue(entry.encounterType, 'Unknown') || 'Unknown',
    type: toStringValue(entry.type, ''),
    unitId: toStringValue(entry.unitId, ''),
    globalConfigHash: toStringValue(entry.globalConfigHash, ''),
    heroDetails: serializeDetails(entry.heroDetails),
    machineOfWarDetails: serializeDetails(entry.machineOfWarDetails),
    cluster_code: clusterCode || null,
    cluster_id: clusterId || null
  }
}
