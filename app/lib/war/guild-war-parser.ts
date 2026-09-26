import { extractGuildWarSnapshotCandidates } from './guild-war-parser-core'
import { convertSnapshotPayload } from './guild-war-convert-snapshot'
import { convertActivityLogPayload } from './guild-war-convert-activity-logs'
import type {
  LokiGuildWarResponse,
  LokiWarData,
  WarConvertContext
} from './war-payload-types'

export * from './guild-war-parser-core'
export type * from './war-payload-types'

export async function convertRawWarPayload(
  payload: LokiGuildWarResponse,
  ctx: WarConvertContext
): Promise<LokiWarData[]> {
  const snapshotCandidates = extractGuildWarSnapshotCandidates(payload)
  return snapshotCandidates.length > 0
    ? convertSnapshotPayload(payload, snapshotCandidates, ctx)
    : convertActivityLogPayload(payload, ctx)
}
