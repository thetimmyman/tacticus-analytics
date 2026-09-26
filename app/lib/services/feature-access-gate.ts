import { Errors } from '@/app/lib/errors/AppError'
import {
  checkFeatureAccess,
  type FeatureAccessResult
} from '@/app/lib/services/feature-release-service'

// Throws the shared 403 `{ error, stage, reason }`. Kept out of feature-release-service.ts so tests
// that vi.doMock that module still mock checkFeatureAccess here.
export async function requireFeatureAccess(
  userId: string,
  feature: string,
  errorMessage: string
): Promise<FeatureAccessResult> {
  const access = await checkFeatureAccess(userId, feature)
  if (!access.has_access) {
    throw Errors.fromResponse(403, {
      error: errorMessage,
      stage: access.stage,
      reason: access.reason
    })
  }
  return access
}
