import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.assignments.current-season-bosses')
import { type SeasonBoss } from '@/app/lib/loki/season-configs'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

const DEFAULT_LEVELS = [
  'M5',
  'M4',
  'M3',
  'M2',
  'M1',
  'L5',
  'L4',
  'L3',
  'L2',
  'L1'
]

const normalizeBossResponse = (bosses: SeasonBoss[]) =>
  bosses.map((boss) => {
    const { canonical, ...rest } = boss
    void canonical
    return rest
  })

export const GET = withErrorHandler(async (_request: NextRequest) => {
  await requireRoleForApi('officer')

  const snapshot = await ensureRotationSnapshot()

  if (!snapshot) {
    logger.error('Unable to resolve guild boss rotation from cache')
    throw Errors.external(
      'Unable to resolve guild boss rotation from LOKI API. Please retry shortly or contact support.',
      503,
      { reason: 'rotation_cache_unavailable' }
    )
  }

  return NextResponse.json({
    success: true,
    configId: snapshot.currentConfigId,
    seasonNumber: snapshot.seasonNumber,
    matches: snapshot.matches,
    observed: snapshot.observedBosses,
    bosses: normalizeBossResponse(snapshot.currentBosses),
    upcomingPreview: normalizeBossResponse(snapshot.nextBosses),
    levels: DEFAULT_LEVELS,
    source: 'loki-rotation-cache',
    resolvedAt: snapshot.resolvedAt
  })
})
