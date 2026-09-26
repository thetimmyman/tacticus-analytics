import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.assignments.next-season-bosses')
import {
  getSeasonConfigIdForOffset,
  type SeasonBoss
} from '@/app/lib/loki/season-configs'
import {
  ensureRotationSnapshot,
  computeFutureConfigBosses
} from '@/app/lib/loki/rotation-cache'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

export const dynamic = 'force-dynamic'

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
    logger.error('Unable to resolve upcoming guild boss rotation from cache')
    throw Errors.external(
      'Unable to resolve upcoming guild boss rotation from LOKI API. Please retry shortly or contact support.',
      503,
      { reason: 'rotation_cache_unavailable' }
    )
  }

  const reference = new Date(snapshot.resolvedAt)
  const futureBosses = computeFutureConfigBosses(2, reference)
  const { id: futureConfigId } = getSeasonConfigIdForOffset(2, reference)

  return NextResponse.json({
    success: true,
    currentConfigId: snapshot.currentConfigId,
    seasonNumber: snapshot.seasonNumber,
    nextConfigId: snapshot.nextConfigId,
    futureConfigId,
    matches: snapshot.matches,
    observed: snapshot.observedBosses,
    bosses: normalizeBossResponse(snapshot.nextBosses),
    futurePreview: normalizeBossResponse(futureBosses),
    levels: DEFAULT_LEVELS,
    source: 'loki-rotation-cache',
    resolvedAt: snapshot.resolvedAt
  })
})
