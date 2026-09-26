// Canonical guild war display names; every visible zone/board name comes from here.
// Names derive from zone_type; never display the legacy guild_war_zones.zone_name.

import rawZoneNames from '@/config/guild-war-zone-names.json'
import rawBoardNames from '@/config/guild-war-board-names.json'

interface ZoneNameEntry {
  name: string
  short: string
  /** The game's own string, not disambiguated. */
  gameName: string
  visualId: string
}

interface ZoneNamesConfig {
  zones: Record<string, ZoneNameEntry>
  notInCurrentGlobalConfig: string[]
}

interface BoardNameEntry {
  name: string
  aliases?: string[]
}

interface BoardNamesConfig {
  boards: Record<string, BoardNameEntry>
}

const zoneNames = (rawZoneNames as unknown as ZoneNamesConfig).zones
const boardNames = (rawBoardNames as unknown as BoardNamesConfig).boards

export const KNOWN_ZONE_TYPES: readonly string[] = Object.freeze(
  Object.keys(zoneNames).sort()
)

export const KNOWN_BOARD_IDS: readonly string[] = Object.freeze(
  Object.keys(boardNames).sort()
)

export const UNKNOWN_ZONE_LABEL = 'Unknown Zone'

/** Last resort for ids missing from the generated config: `AntiAirBattery3` -> "Anti Air Battery 3". */
export function humanizeUnknownZoneType(zoneType: string): string {
  return zoneType
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
}

/** Pass the raw `zone_type`, never `zone_name`. */
export function zoneDisplayName(zoneType: string | null | undefined): string {
  if (typeof zoneType !== 'string' || zoneType.trim() === '') {
    return UNKNOWN_ZONE_LABEL
  }
  const key = zoneType.trim()
  const entry = zoneNames[key]
  if (entry) return entry.name
  return humanizeUnknownZoneType(key)
}

export function zoneShortName(zoneType: string | null | undefined): string {
  if (typeof zoneType !== 'string' || zoneType.trim() === '') {
    return UNKNOWN_ZONE_LABEL
  }
  const key = zoneType.trim()
  return zoneNames[key]?.short ?? zoneDisplayName(key)
}

// In-game name without disambiguation (Bunker1 and Bunker2 share one); only where wording must match.
export function zoneGameName(zoneType: string | null | undefined): string {
  if (typeof zoneType !== 'string' || zoneType.trim() === '') {
    return UNKNOWN_ZONE_LABEL
  }
  const key = zoneType.trim()
  return zoneNames[key]?.gameName ?? zoneDisplayName(key)
}

export function zoneVisualId(
  zoneType: string | null | undefined
): string | null {
  if (typeof zoneType !== 'string') return null
  return zoneNames[zoneType.trim()]?.visualId ?? null
}

// The game ships no board names: these are community names, falling back to the raw id as players do.
export function boardDisplayName(boardId: string | null | undefined): string {
  if (typeof boardId !== 'string' || boardId.trim() === '')
    return 'Unknown Board'
  const key = boardId.trim()
  return boardNames[key]?.name ?? key
}

export function hasBoardName(boardId: string | null | undefined): boolean {
  return typeof boardId === 'string' && boardId.trim() in boardNames
}
