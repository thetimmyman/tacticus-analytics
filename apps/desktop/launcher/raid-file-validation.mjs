export const RAID_FILE_MAX_BYTES = 8 * 1024 * 1024
const fields = new Set([
  'userId',
  'username',
  'type',
  'unitId',
  'encounterType',
  'encounterIndex',
  'damageType',
  'damageDealt',
  'remainingHp',
  'maxHp',
  'rarity',
  'tier',
  'set',
  'startedOn',
  'completedOn',
  'timestamp',
  'globalConfigHash',
  'heroDetails',
  'machineOfWarDetails'
])
const unitFields = new Set([
  'unitId',
  'power',
  'rank',
  'rarity',
  'level',
  'stars',
  'ascension',
  'activeAbilityLevel',
  'passiveAbilityLevel',
  'equipment',
  'abilities'
])
const invalid = () => new Error('Invalid raid file. No data was imported.')
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid()
  return value
}
function exactKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalid()
}
function text(value, max = 128) {
  if (
    typeof value !== 'string' ||
    !value.trim().length ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw invalid()
  return value.trim()
}
function integer(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw invalid()
  return value
}
function eventTime(value) {
  if (typeof value === 'string') {
    if (value.length > 64) throw invalid()
    const parts = /^(\d{4})-(\d\d)-(\d\d)T/.exec(value)
    if (parts) {
      const date = new Date(
        Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
      )
      if (
        date.getUTCFullYear() !== Number(parts[1]) ||
        date.getUTCMonth() !== Number(parts[2]) - 1 ||
        date.getUTCDate() !== Number(parts[3])
      )
        throw invalid()
    }
  }
  const timestamp =
    typeof value === 'number'
      ? value > 1_000_000_000_000
        ? value
        : value * 1000
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value) > 1_000_000_000_000
          ? Number(value)
          : Number(value) * 1000
        : typeof value === 'string' &&
            /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
          ? Date.parse(value)
          : NaN
  if (
    !Number.isFinite(timestamp) ||
    timestamp < Date.UTC(2000, 0, 1) ||
    timestamp > Date.UTC(2100, 0, 1)
  )
    throw invalid()
  return timestamp
}
function unit(value) {
  const data = object(value)
  exactKeys(data, unitFields)
  text(data.unitId)
  for (const [key, item] of Object.entries(data)) {
    if (key === 'unitId') continue
    // Nested equipment/ability contracts need their own reviewed format.
    // Refuse them rather than retaining untyped fields or silently dropping data.
    if (key === 'equipment' || key === 'abilities') throw invalid()
    integer(item, key === 'power' ? 1_000_000_000_000 : 100000)
  }
}
export function parseRaidFile(contents) {
  if (
    typeof contents !== 'string' ||
    new TextEncoder().encode(contents).byteLength > RAID_FILE_MAX_BYTES
  )
    throw invalid()
  let file
  try {
    file = object(JSON.parse(contents))
  } catch {
    throw invalid()
  }
  exactKeys(file, new Set(['format', 'guildCode', 'season', 'entries']))
  if (file.format !== 'ta-raid-file-v1') throw invalid()
  const guildCode = text(file.guildCode, 32)
  if (!/^[A-Za-z0-9_-]+$/.test(guildCode)) throw invalid()
  const season = integer(file.season, 999999)
  if (
    season < 1 ||
    !Array.isArray(file.entries) ||
    file.entries.length < 1 ||
    file.entries.length > 10000
  )
    throw invalid()
  const entries = file.entries.map((value) => {
    const entry = object(value)
    exactKeys(entry, fields)
    text(entry.userId)
    text(entry.type)
    integer(entry.encounterIndex, 1000)
    integer(entry.damageDealt, 1_000_000_000_000)
    integer(entry.remainingHp, 1_000_000_000_000)
    integer(entry.maxHp, 1_000_000_000_000)
    integer(entry.tier, 10000)
    integer(entry.set, 4)
    if (
      !['Battle', 'Bomb'].includes(String(entry.damageType)) ||
      !['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'].includes(
        String(entry.rarity)
      )
    )
      throw invalid()
    if (entry.username !== undefined) text(entry.username)
    for (const key of ['unitId', 'encounterType', 'globalConfigHash'])
      if (entry[key] !== undefined) text(entry[key])
    if (entry.timestamp !== undefined) eventTime(entry.timestamp)
    const started = eventTime(entry.startedOn ?? entry.timestamp)
    const completed = eventTime(entry.completedOn ?? entry.timestamp)
    if (completed < started || entry.remainingHp > entry.maxHp) throw invalid()
    if (entry.heroDetails !== undefined && entry.heroDetails !== null) {
      if (!Array.isArray(entry.heroDetails) || entry.heroDetails.length > 5)
        throw invalid()
      entry.heroDetails.forEach(unit)
    }
    if (
      entry.machineOfWarDetails !== undefined &&
      entry.machineOfWarDetails !== null
    )
      unit(entry.machineOfWarDetails)
    return entry
  })
  return { guildCode, season, entries }
}
