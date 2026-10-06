export interface OfficialRosterUnit {
  id: string
  name?: string
  faction?: string
  grandAlliance?: 'Imperial' | 'Chaos' | 'Xenos'
  progressionIndex: number
  rank: number
  xp: number
  xpLevel: number
  shards: number
  mythicShards: number
  abilities: Array<{ id: string; level: number }>
  upgrades: number[]
  items: Array<{
    id: string
    slotId: 'Slot1' | 'Slot2' | 'Slot3'
    level: number
    name?: string
    rarity?: string
  }>
}
export interface OfficialRosterProjection {
  playerName: string
  powerLevel: number
  units: OfficialRosterUnit[]
  machinesOfWar: OfficialRosterUnit[]
}
export const ROSTER_MAX_BYTES: number
export function projectOfficialRoster(value: unknown): OfficialRosterProjection
export function parseRosterSnapshot(
  contents: string
): OfficialRosterProjection & {
  format: 'ta-official-roster-v1'
  guildCode: string
}
