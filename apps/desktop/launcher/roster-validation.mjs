export const ROSTER_MAX_BYTES = 4 * 1024 * 1024
const invalid = () =>
  new Error('Unsupported roster data. Existing roster was preserved.')
const object = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid()
  return value
}
const text = (value, max = 128) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw invalid()
  return value.trim()
}
const id = (value) => {
  const result = text(value, 100)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw invalid()
  return result
}
const integer = (value, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw invalid()
  return value
}
const list = (value, max, project, key) => {
  if (!Array.isArray(value) || value.length > max) throw invalid()
  const result = value.map(project)
  if (key && new Set(result.map((item) => item[key])).size !== result.length)
    throw invalid()
  return result
}
const item = (value) => {
  const data = object(value)
  if (!['Slot1', 'Slot2', 'Slot3'].includes(data.slotId)) throw invalid()
  const result = {
    id: id(data.id),
    level: integer(data.level, 1, 11),
    slotId: data.slotId
  }
  if (data.name !== undefined) result.name = text(data.name)
  if (data.rarity !== undefined) {
    if (
      !['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'].includes(
        data.rarity
      )
    )
      throw invalid()
    result.rarity = data.rarity
  }
  return result
}
const unit = (value) => {
  const data = object(value)
  const result = {
    id: id(data.id),
    progressionIndex: integer(data.progressionIndex, 0, 15),
    rank: integer(data.rank, 0, 17),
    xp: integer(data.xp, 0, 2147483647),
    xpLevel: integer(data.xpLevel, 1, 50),
    shards: integer(data.shards, 0, 2147483647),
    mythicShards: integer(data.mythicShards, 0, 2147483647),
    abilities: list(
      data.abilities,
      2,
      (ability) => {
        const a = object(ability)
        return { id: id(a.id), level: integer(a.level, 0, 50) }
      },
      'id'
    ),
    items: list(data.items, 3, item, 'slotId'),
    upgrades: list(data.upgrades, 6, (upgrade) => integer(upgrade, 0, 5))
  }
  if (new Set(result.upgrades).size !== result.upgrades.length) throw invalid()
  if (data.name !== undefined) result.name = text(data.name)
  if (data.faction !== undefined) result.faction = text(data.faction, 64)
  if (data.grandAlliance !== undefined) {
    if (!['Imperial', 'Chaos', 'Xenos'].includes(data.grandAlliance))
      throw invalid()
    result.grandAlliance = data.grandAlliance
  }
  return result
}

// Project only the published roster fields. Inventory, progress, identifiers,
// upstream URLs and arbitrary metadata do not cross the trusted broker boundary.
export function projectOfficialRoster(value) {
  const player = object(value),
    details = object(player.details)
  const units = list(player.units, 1024, unit, 'id')
  const mowLists = [
    'machinesOfWar',
    'machines_of_war',
    'machineOfWar',
    'machine_of_war'
  ].filter((key) => player[key] !== undefined)
  if (mowLists.length > 1) throw invalid()
  const machinesOfWar = mowLists.length
    ? list(player[mowLists[0]], 128, unit, 'id')
    : []
  const byId = new Map(units.map((value) => [value.id, value]))
  for (const value of machinesOfWar)
    if (
      byId.has(value.id) &&
      JSON.stringify(byId.get(value.id)) !== JSON.stringify(value)
    )
      throw invalid()
  const result = {
    playerName: text(details.name),
    powerLevel: integer(details.powerLevel, 0, 2147483647),
    units,
    machinesOfWar
  }
  if (Buffer.byteLength(JSON.stringify(result)) > ROSTER_MAX_BYTES)
    throw invalid()
  return result
}

export function parseRosterSnapshot(contents) {
  if (
    typeof contents !== 'string' ||
    Buffer.byteLength(contents) > ROSTER_MAX_BYTES
  )
    throw invalid()
  const value = object(JSON.parse(contents))
  if (
    value.format !== 'ta-official-roster-v1' ||
    Object.keys(value).some(
      (key) =>
        ![
          'format',
          'guildCode',
          'playerName',
          'powerLevel',
          'units',
          'machinesOfWar'
        ].includes(key)
    ) ||
    typeof value.guildCode !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(value.guildCode)
  )
    throw invalid()
  return {
    format: 'ta-official-roster-v1',
    guildCode: value.guildCode,
    ...projectOfficialRoster({
      details: { name: value.playerName, powerLevel: value.powerLevel },
      units: value.units,
      machinesOfWar: value.machinesOfWar
    })
  }
}
