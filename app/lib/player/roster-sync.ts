import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.player.roster-sync')
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ServiceSupabaseClient } from '@/app/lib/db'
import {
  commitPlayerRosterSnapshot,
  type RosterObservation,
  type RosterSnapshotReceipt
} from './roster-snapshot-store'
import {
  getRankName,
  getRarityFromProgressionIndex
} from '@/app/(dashboard)/roster/utils/roster-helpers'
import { loadItemTypeMap } from '@/app/lib/player/item-catalog'

/** Level is 1-based; itemType is not always supplied and is recovered from items.json. */
export type AnyUnitItem = {
  id: string
  level?: number
  itemType?: string
}

export type AnyUnit = {
  id: string
  rank?: number
  progressionIndex?: number
  xpLevel?: number
  abilities?: Array<{ id: string; level: number }>
  items?: AnyUnitItem[]
}

export type PersistRosterSnapshotOptions = {
  playerPower?: number | null
  observation?: RosterObservation
}

/** No hero equips both I_Block and I_Defensive, so one defensive column suffices. */
export function classifyRosterItems(
  items: AnyUnitItem[] | undefined,
  itemTypeById: Map<string, string>
): {
  crit_item_id: string | null
  crit_item_level: number | null
  defensive_item_id: string | null
  defensive_item_level: number | null
  booster_item_id: string | null
  booster_item_level: number | null
} {
  const result = {
    crit_item_id: null as string | null,
    crit_item_level: null as number | null,
    defensive_item_id: null as string | null,
    defensive_item_level: null as number | null,
    booster_item_id: null as string | null,
    booster_item_level: null as number | null
  }
  if (!Array.isArray(items)) return result

  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id) continue
    const itemType = item.itemType || itemTypeById.get(item.id)
    if (!itemType) continue
    const level =
      typeof item.level === 'number' && item.level > 0 ? item.level : null
    if (itemType === 'I_Crit') {
      result.crit_item_id = item.id
      result.crit_item_level = level
    } else if (itemType === 'I_Block' || itemType === 'I_Defensive') {
      result.defensive_item_id = item.id
      result.defensive_item_level = level
    } else if (
      itemType === 'I_Booster_Crit' ||
      itemType === 'I_Booster_Block'
    ) {
      result.booster_item_id = item.id
      result.booster_item_level = level
    }
  }
  return result
}

function resolveAbilityLevels(
  abilities?: Array<{ id: string; level: number }>
): {
  active: number | null
  passive: number | null
} {
  if (!Array.isArray(abilities) || abilities.length === 0)
    return { active: null, passive: null }

  let active: number | null = null
  let passive: number | null = null

  for (const ability of abilities) {
    const id = typeof ability.id === 'string' ? ability.id.toLowerCase() : ''
    if (!id || typeof ability.level !== 'number') continue
    if (id.includes('active') && active == null) active = ability.level
    if (id.includes('passive') && passive == null) passive = ability.level
  }

  const firstAbility = abilities[0]
  if (active == null && typeof firstAbility?.level === 'number') {
    active = firstAbility.level
  }
  const secondAbility = abilities[1]
  if (passive == null && typeof secondAbility?.level === 'number') {
    passive = secondAbility.level
  }

  return { active, passive }
}

/** The unit's own itemType wins, else items.json (there is no items table). Never throws. */
async function buildItemTypeMap(
  units: AnyUnit[]
): Promise<{ map: Map<string, string>; complete: boolean }> {
  const map = new Map<string, string>()
  const needLookup = new Set<string>()

  for (const u of units) {
    if (!Array.isArray(u.items)) continue
    for (const item of u.items) {
      if (!item || typeof item.id !== 'string' || !item.id) continue
      if (item.itemType) {
        map.set(item.id, item.itemType)
      } else if (!map.has(item.id)) {
        needLookup.add(item.id)
      }
    }
  }

  if (needLookup.size === 0) return { map, complete: true }

  try {
    const resolved = await loadItemTypeMap(needLookup)
    for (const [id, itemType] of resolved) map.set(id, itemType)
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      '[RosterSync] itemType resolution from items.json threw; equipment slots may be left null'
    )
  }
  return { map, complete: [...needLookup].every((id) => map.has(id)) }
}

const normalizePlayerPower = (
  value: number | null | undefined
): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.trunc(value)
}

/** Canonical mapped roster rows, shared by hosted sync and local transactions. */
async function prepareRosterSnapshot(
  userId: string | null,
  units: AnyUnit[],
  mows: AnyUnit[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  playerMappingId?: number
) {
  const allUnits = [...units, ...mows]
  if (allUnits.length === 0) return { rows: [], complete: false }

  const unitIds = [...new Set(allUnits.map((u) => u.id).filter(Boolean))]
  if (unitIds.length === 0) return { rows: [], complete: false }

  const { data: mappings, error: mapErr } = await supabase
    .from('hero_mappings')
    .select('id, unit_id')
    .in('unit_id', unitIds)

  if (mapErr || !mappings?.length) return { rows: [], complete: false }

  const unitIdToMappingId = new Map<string, number>(
    (mappings as Array<{ id: number; unit_id: string }>).map((m) => [
      m.unit_id,
      m.id
    ])
  )

  const { map: itemTypeById, complete: equipmentComplete } =
    await buildItemTypeMap(allUnits)

  const rows = allUnits
    .filter((u) => u.id && unitIdToMappingId.has(u.id))
    .map((u) => {
      const { active, passive } = resolveAbilityLevels(u.abilities)
      const itemCols = classifyRosterItems(u.items, itemTypeById)
      return {
        ...(userId ? { user_id: userId } : {}),
        // Claimed rows keep the user_id conflict path; setting both keys can
        // violate player_roster_mapping_hero_key.
        ...(!userId && playerMappingId
          ? { player_mapping_id: playerMappingId }
          : {}),
        hero_mapping_id: unitIdToMappingId.get(u.id)!,
        stars: u.progressionIndex ?? 0,
        progression_index: u.progressionIndex ?? null,
        rarity: getRarityFromProgressionIndex(u.progressionIndex ?? 0),
        rank_name: getRankName(u.rank ?? 0),
        xp_level: u.xpLevel ?? null,
        active_ability_level: active,
        passive_ability_level: passive,
        ...itemCols,
        synced_at: new Date().toISOString()
      }
    })

  return {
    rows,
    complete:
      equipmentComplete &&
      allUnits.every((unit) => Boolean(unit.id)) &&
      rows.length === unitIds.length
  }
}

/** Preserve local import normalization; hosted writes require complete evidence. */
export async function buildRosterSnapshotRows(
  userId: string | null,
  units: AnyUnit[],
  mows: AnyUnit[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  playerMappingId?: number
) {
  return (
    await prepareRosterSnapshot(userId, units, mows, supabase, playerMappingId)
  ).rows
}

/** Keyed by userId (site accounts) or playerMappingId (unclaimed); units missing from hero_mappings are skipped. */
export async function persistRosterSnapshot(
  userId: string | null,
  units: AnyUnit[],
  mows: AnyUnit[],
  supabase: ServiceSupabaseClient,
  playerMappingId?: number,
  options: PersistRosterSnapshotOptions = {}
): Promise<RosterSnapshotReceipt> {
  const observation = options.observation
  if (
    !observation ||
    (playerMappingId !== undefined &&
      observation.playerMappingId !== playerMappingId)
  )
    throw new Error('Roster observation required')

  const { rows, complete } = await prepareRosterSnapshot(
    userId,
    units,
    mows,
    supabase,
    playerMappingId
  )
  // Missing mappings or equipment classifications cannot erase trusted columns.
  const imported = (complete ? rows : []).map(
    ({
      user_id: _user,
      player_mapping_id: _mapping,
      synced_at: _synced,
      ...row
    }) => row
  )
  return commitPlayerRosterSnapshot(
    observation,
    userId,
    imported,
    normalizePlayerPower(options.playerPower),
    complete,
    supabase
  )
}
