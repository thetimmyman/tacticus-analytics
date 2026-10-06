import {
  processRaidEntry,
  type BossMappings,
  type RawRaidEntry
} from '@/app/lib/sync/transformers'

import { parseRaidFile } from '@/apps/desktop/launcher/raid-file-validation.mjs'
export {
  parseRaidFile,
  RAID_FILE_MAX_BYTES
} from '@/apps/desktop/launcher/raid-file-validation.mjs'

const invalid = () => new Error('Invalid raid file. No data was imported.')

export function normalizeRaidFile(
  contents: string,
  context: {
    guildCode: string
    playerMappings: Map<string, string>
    bossMappings: BossMappings
    clusterCode: string | null
    clusterId: string | null
  }
) {
  const file = parseRaidFile(contents)
  if (file.guildCode !== context.guildCode) throw invalid()
  return file.entries.map((entry) => {
    const row = processRaidEntry(
      entry as RawRaidEntry,
      context.guildCode,
      String(file.season),
      context.playerMappings,
      context.bossMappings,
      context.clusterCode,
      context.clusterId
    )
    if (!row || row.Name === 'Unknown' || row.displayName === 'Unknown')
      throw invalid()
    return row
  })
}
