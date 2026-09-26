import { createComponentLogger } from '@/app/lib/logging'
import { loopIndexFromTier } from '@/app/lib/calculations/loop-from-tier'
import {
  isErasureTombstone,
  isUidLikeName
} from '@/supabase/functions/_shared/player-name-resolution-core'
const logger = createComponentLogger('lib.sync.transformers')
import type { EOTGRData, PlayerRole } from '@tacticus/app-core/types'
import type { Database as SupabaseDatabase } from '@tacticus/app-core/database.generated'

export function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toIsoTimestampOrNull(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      if (Number.isFinite(numeric)) {
        const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
        const date = new Date(ms)
        if (!Number.isNaN(date.getTime())) return date.toISOString()
      }
    }
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

// This path and the edge function must write identical precision, or the
// `unique_battle_record_complete` index misses duplicates between them.
export function truncateIsoToWholeSecond(
  iso: string | null | undefined
): string | null {
  if (!iso) return null
  return iso.replace(/\.\d+Z$/, '.000Z')
}

export type RawRaidEntry = Partial<EOTGRData> & Record<string, unknown>

export type ProcessedRaidEntry = Omit<
  EOTGRData,
  'id' | 'cluster_code' | 'cluster_id' | 'season_num'
> & {
  cluster_code: string | null
  cluster_id: string | null
}

export type BossMappings = Record<string, Record<number, string>>

export type AppRole = SupabaseDatabase['public']['Enums']['app_role']

export type LokiMember = {
  userId: string
  displayName: string
  role: PlayerRole | string
  hasDuplicateName?: boolean
  originalDisplayName?: string | null
  avatarUnitId?: string | null
  playerLevel?: number | null
  playerPower?: number | null
}

const APP_ROLES: readonly AppRole[] = [
  'leader',
  'officer',
  'member',
  'Leader',
  'Member',
  'Officer',
  'demo'
] as const

const RARITY_BASE_TIERS = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
  Mythic: 5,
  Unknown: 0
} as const

export function normalizeAppRole(role: string | null | undefined): AppRole {
  if (!role) {
    return 'member'
  }

  const match = APP_ROLES.find(
    (allowedRole) => allowedRole.toLowerCase() === role.toLowerCase()
  )

  return match ?? 'member'
}

export function processTimestamp(
  timestamp: string | number | Date | null | undefined
): string {
  if (!timestamp) return new Date().toISOString()

  try {
    if (timestamp instanceof Date) {
      return timestamp.toISOString()
    }

    if (typeof timestamp === 'number') {
      const ts = timestamp < 10000000000 ? timestamp * 1000 : timestamp
      return new Date(ts).toISOString()
    }

    const numericValue = Number(timestamp)
    if (!Number.isNaN(numericValue)) {
      const ts = numericValue < 10000000000 ? numericValue * 1000 : numericValue
      return new Date(ts).toISOString()
    }

    const parsed = new Date(timestamp)
    return Number.isNaN(parsed.getTime())
      ? new Date().toISOString()
      : parsed.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

export function processSetValue(
  setValue: string | number | null | undefined
): number {
  const normalizedValue =
    typeof setValue === 'number' ? setValue.toString() : (setValue ?? '')
  const setNum = parseInt(normalizedValue, 10)
  if (isNaN(setNum) || setNum < 0) return 0
  if (setNum > 4) return 4
  return setNum
}

export function formatUnitDisplayName(unitId: string): string {
  return unitId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

export function lookupPlayerMapping(
  playerMappings: Map<string, string>,
  userId: string,
  fallback = 'Unknown'
): string {
  if (playerMappings.has(userId)) {
    return playerMappings.get(userId)!
  }
  const lowerUserId = userId.toLowerCase()
  if (playerMappings.has(lowerUserId)) {
    return playerMappings.get(lowerUserId)!
  }
  return userId || fallback
}

export function validateDataTypes(
  entry: { Guild?: string | null; Season?: string | null },
  guildCode: string
): boolean {
  void guildCode
  if (!entry.Guild || typeof entry.Guild !== 'string') {
    return false
  }

  if (!entry.Season || typeof entry.Season !== 'string') {
    return false
  }

  return true
}

type RarityKey = keyof typeof RARITY_BASE_TIERS

export function processRaidEntry(
  entry: RawRaidEntry,
  guildCode: string,
  season: string,
  playerMappings: Map<string, string>,
  bossMappings: BossMappings,
  clusterCode: string | null,
  clusterId: string | null
): ProcessedRaidEntry | null {
  if (clusterCode === 'null' || clusterCode === 'undefined') {
    clusterCode = null
    clusterId = null
  }

  const userId = toStringValue(entry.userId, '').trim()
  const rawUsername = toStringValue(entry.username, '').trim()

  // Upstream `Player#XXXXXX` privacy aliases and tombstones are never promoted to a display name.
  let displayName: string
  if (userId && playerMappings.has(userId)) {
    displayName = playerMappings.get(userId)!
  } else if (userId && playerMappings.has(userId.toLowerCase())) {
    displayName = playerMappings.get(userId.toLowerCase())!
  } else if (
    rawUsername &&
    !isUidLikeName(rawUsername) &&
    !isErasureTombstone(rawUsername)
  ) {
    displayName = rawUsername
  } else if (userId) {
    const shortId = userId.replace(/-/g, '').substring(0, 6).toUpperCase()
    displayName = `Player#${shortId}`
  } else {
    displayName = 'Unknown'
  }

  // Drop rather than default to 0 (a phantom main-boss row), as the edge path does.
  const encounterIndexValue = toNumberValue(entry.encounterIndex)
  if (encounterIndexValue === null) {
    return null
  }
  const encounterIndex = Math.trunc(encounterIndexValue)

  let bossName: string
  if (encounterIndex === 0) {
    bossName = toStringValue(entry.type, 'Unknown') || 'Unknown'
  } else if (encounterIndex > 0 && entry.type) {
    const typeKey = String(entry.type)
    if (bossMappings[typeKey]?.[encounterIndex]) {
      bossName = bossMappings[typeKey][encounterIndex]
    } else {
      bossName = `${typeKey} Prime ${encounterIndex}`
    }
  } else {
    bossName = 'Unknown'
  }

  const tier = Math.max(0, Math.trunc(toNumberValue(entry.tier) ?? 0))
  const enemyHp = Math.max(0, Math.trunc(toNumberValue(entry.maxHp) ?? 0))

  let rarity: RarityKey
  if (enemyHp === 30000000 || enemyHp === 2400000) {
    rarity = 'Mythic'
  } else {
    const entryRarity =
      typeof entry.rarity === 'string' ? entry.rarity : 'Unknown'
    rarity = Object.prototype.hasOwnProperty.call(
      RARITY_BASE_TIERS,
      entryRarity
    )
      ? (entryRarity as RarityKey)
      : 'Unknown'
  }

  const loopIndex = loopIndexFromTier(tier)

  const normalizedDamageType = (toStringValue(entry.damageType, 'Battle') ||
    'Battle') as 'Battle' | 'Bomb'

  return {
    Guild: String(guildCode),
    Season: String(season),
    userId: userId,
    displayName: displayName,
    Name: bossName,
    type: toStringValue(entry.type, ''),
    encounterType: toStringValue(entry.encounterType, 'Unknown') || 'Unknown',
    encounterId: encounterIndex,
    encounterIndex: encounterIndex,
    damageType: normalizedDamageType,
    damageDealt: Math.max(0, Math.trunc(toNumberValue(entry.damageDealt) ?? 0)),
    remainingHp: Math.max(0, Math.trunc(toNumberValue(entry.remainingHp) ?? 0)),
    maxHp: enemyHp,
    // Never null: the dedup index is NULLS DISTINCT, so a null would re-insert
    // the battle every sync.
    startedOn: truncateIsoToWholeSecond(
      toIsoTimestampOrNull(entry.startedOn) ??
        toIsoTimestampOrNull(entry.timestamp) ??
        processTimestamp(entry.startedOn ?? entry.timestamp)
    ),
    completedOn: truncateIsoToWholeSecond(
      toIsoTimestampOrNull(entry.completedOn) ??
        toIsoTimestampOrNull(entry.timestamp) ??
        processTimestamp(entry.completedOn ?? entry.timestamp)
    ),
    timestamp: new Date().toISOString(),
    rarity: rarity,
    tier: tier,
    set: processSetValue(entry.set),
    loopIndex: loopIndex,
    heroDetails: entry.heroDetails
      ? typeof entry.heroDetails === 'string'
        ? entry.heroDetails
        : JSON.stringify(entry.heroDetails)
      : null,
    machineOfWarDetails: entry.machineOfWarDetails
      ? typeof entry.machineOfWarDetails === 'string'
        ? entry.machineOfWarDetails
        : JSON.stringify(entry.machineOfWarDetails)
      : null,
    unitId: toStringValue(entry.unitId, ''),
    globalConfigHash: toStringValue(entry.globalConfigHash, ''),
    cluster_code: clusterCode || null,
    cluster_id: clusterId || null
  }
}

// The `<name> (<guildCode>_<NN>)` suffix is persisted and joined on by
// analytics RPCs. Mirror any change in supabase/functions/_shared/
// display-name-dedup.ts (parity test: display-name-dedup-parity.test.ts).
export function handleDuplicateDisplayNames(
  lokiMembers: LokiMember[],
  guildCode: string
): LokiMember[] {
  const nameGroups = new Map<string, LokiMember[]>()

  for (const member of lokiMembers) {
    const rawDisplayName =
      typeof member.displayName === 'string' ? member.displayName.trim() : ''
    const normalizedDisplayName =
      rawDisplayName.length > 0
        ? rawDisplayName
        : typeof member.userId === 'string' && member.userId.trim().length > 0
          ? member.userId
          : `UNKNOWN_${guildCode}`

    const members = nameGroups.get(normalizedDisplayName) ?? []
    members.push(member)
    nameGroups.set(normalizedDisplayName, members)
  }

  const processedMembers: LokiMember[] = []

  for (const [displayName, members] of nameGroups) {
    if (members.length === 1) {
      const [member] = members
      if (member) {
        processedMembers.push(member)
      }
    } else {
      members.sort((a, b) => {
        const aId = typeof a.userId === 'string' ? a.userId : ''
        const bId = typeof b.userId === 'string' ? b.userId : ''
        return aId.localeCompare(bId)
      })

      for (let i = 0; i < members.length; i++) {
        const baseMember = members[i]
        if (!baseMember) continue
        const suffix = `(${guildCode}_${String(i + 1).padStart(2, '0')})`
        const modifiedMember: LokiMember = {
          ...baseMember,
          displayName: `${displayName} ${suffix}`,
          originalDisplayName: displayName,
          hasDuplicateName: true
        }
        processedMembers.push(modifiedMember)
      }
    }
  }

  return processedMembers
}

export type GuildRaidApiResponse = {
  season?: string | number | null
  currentSeason?: string | number | null
  body?: {
    season?: string | number | null
    entries?: RawRaidEntry[]
    sessionId?: string | null
  }
  entries?: RawRaidEntry[]
  sessionId?: string | null
  playerEvent?: {
    sessionId?: string | null
  } | null
  eventResult?: {
    sessionId?: string | null
    eventResponseData?: {
      sessionId?: string | null
      playerEvent?: {
        sessionId?: string | null
      } | null
    } | null
  } | null
  response?: {
    sessionId?: string | null
  } | null
  event?: {
    sessionId?: string | null
  } | null
}

export function detectSeason(
  data: GuildRaidApiResponse | null | undefined,
  entries: RawRaidEntry[]
): string | null {
  const possiblePaths = [data?.season, data?.body?.season, data?.currentSeason]

  for (const season of possiblePaths) {
    if (season && season !== 'null' && season !== 'undefined') {
      return String(season)
    }
  }

  const entrySeason = entries[0]?.season
  if (entrySeason) {
    return String(entrySeason)
  }

  // Never invent a season from calendar math; the caller falls back to get_latest_season.
  return null
}

export function extractEntries(data: GuildRaidApiResponse): RawRaidEntry[] {
  return Array.isArray(data.entries)
    ? data.entries
    : Array.isArray(data.body?.entries)
      ? data.body.entries
      : []
}

export function filterValidEntries(entries: RawRaidEntry[]): RawRaidEntry[] {
  return entries.filter((entry): entry is RawRaidEntry => {
    return typeof entry.userId === 'string' && (!!entry.type || !!entry.unitId)
  })
}

export function sanitizeRaidEntries(
  rawEntries: RawRaidEntry[],
  guildCode: string
): { sanitized: RawRaidEntry[]; dropped: number } {
  const sanitized: RawRaidEntry[] = []
  let dropped = 0

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') {
      dropped++
      continue
    }

    const userId = typeof raw.userId === 'string' ? raw.userId.trim() : ''
    if (!userId) {
      dropped++
      continue
    }

    // Null/unparseable would become a phantom encounterIndex=0 row.
    const encounterIndex = toNumberValue(raw.encounterIndex)
    if (
      encounterIndex === null ||
      !Number.isFinite(encounterIndex) ||
      encounterIndex < 0 ||
      encounterIndex > 1000
    ) {
      dropped++
      continue
    }

    sanitized.push(raw)
  }

  if (dropped > 0) {
    logger.warn({ guildCode, dropped }, 'Sanitization dropped invalid entries')
  }

  return { sanitized, dropped }
}

/** strict (full sync) also requires a real Guild and Season. */
export function filterProcessedData(
  processedData: (ProcessedRaidEntry | null)[],
  strict = true
): ProcessedRaidEntry[] {
  return processedData.filter((entry): entry is ProcessedRaidEntry => {
    if (!entry) return false
    if (entry.Name === 'Unknown' || entry.displayName === 'Unknown')
      return false
    if (strict) {
      return !!(
        entry.Guild &&
        entry.Season &&
        entry.Guild !== 'null' &&
        entry.Season !== 'Unknown'
      )
    }
    return true
  })
}
