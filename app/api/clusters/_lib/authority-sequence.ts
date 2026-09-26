import type { Database } from '@/app/lib/db'
import {
  assignAndReconcileCurrentMapping,
  type ClusterAuthorityTarget,
  type CurrentMappingAuthorityRow,
  type MappingAssignmentOutcome
} from './membership-authority'

export function completeClusterAuthoritySequence({
  authority,
  currentMapping,
  userId,
  clusterTarget
}: {
  authority: Database
  currentMapping: CurrentMappingAuthorityRow
  userId: string
  clusterTarget: ClusterAuthorityTarget
}): Promise<MappingAssignmentOutcome> {
  return assignAndReconcileCurrentMapping(
    authority,
    currentMapping,
    userId,
    clusterTarget
  )
}
