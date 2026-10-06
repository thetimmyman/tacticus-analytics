import type { RawRaidEntry } from '../../../app/lib/sync/transformers'

export const RAID_FILE_MAX_BYTES: number
export function parseRaidFile(contents: string): {
  guildCode: string
  season: number
  entries: RawRaidEntry[]
}
