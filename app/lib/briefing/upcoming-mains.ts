import { DEFAULT_STAGE_DURATION_SECONDS } from '@/app/lib/boss-assignments/stage-timing'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import type { StageStartProjection } from '@/app/lib/boss-assignments/stage-timing'
import type { UpcomingMain } from '@/app/lib/briefing/build-next-move-economy'

/** The elapsed part of the current stage is subtracted; the uniform offset never reorders. */
export function buildUpcomingMains(
  sequence: ReadonlyArray<BossStageEntry>,
  projections: ReadonlyArray<StageStartProjection>,
  remainingFrac: number,
  displayByType: ReadonlyMap<string, string>
): UpcomingMain[] {
  if (sequence.length <= 1) return []
  const frac = Math.min(
    1,
    Math.max(0, Number.isFinite(remainingFrac) ? remainingFrac : 1)
  )
  const curStageSpan =
    projections[1]?.inboundDurationSeconds ?? DEFAULT_STAGE_DURATION_SECONDS
  const elapsedCurrent = Math.max(0, curStageSpan * (1 - frac))

  let historySoFar = true
  const out: UpcomingMain[] = []
  for (let i = 1; i < sequence.length; i++) {
    const stage = sequence[i]!
    const proj = projections[i]
    if (
      proj?.inboundDurationSource === 'fallback' ||
      proj?.inboundDurationSource == null
    ) {
      historySoFar = false
    }
    const bossType = stage.encounters.main.bossType
    const etaFromNow = Math.max(60, (proj?.startSeconds ?? 0) - elapsedCurrent)
    out.push({
      name: stage.encounters.main.bossName,
      bossType,
      displayName: displayByType.get(bossType) ?? '',
      stageCode: stage.stageCode,
      loopIndex: stage.loopIndex,
      etaSeconds: etaFromNow,
      etaSource: historySoFar ? 'history' : 'estimate'
    })
  }
  return out
}
