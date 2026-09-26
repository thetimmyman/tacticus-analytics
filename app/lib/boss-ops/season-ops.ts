import { parseSeasonNoteField } from '@/app/lib/boss-ops/season-note-field'

export type SeasonOps = {
  pingMode: 'combined' | 'per_side' | 'skip_all' | null
  // null = cleared (no fallback); undefined = never set (fall back).
  mainNotes: string | null | undefined
  side1Notes: string | null | undefined
  side2Notes: string | null | undefined
  side1Behaviour: 'skip' | 'kill' | 'threshold'
  side2Behaviour: 'skip' | 'kill' | 'threshold'
  side1ThresholdHpPct: number | null
  side2ThresholdHpPct: number | null
}

export const seasonOpsKey = ({
  seasonNumber,
  difficultyCode
}: {
  seasonNumber: number
  difficultyCode: string
}) => `${seasonNumber}__${difficultyCode}`

const normalizeSideBehaviour = (
  skipped: boolean,
  threshold: number | null
): 'skip' | 'kill' | 'threshold' => {
  if (skipped) return 'skip'
  return typeof threshold === 'number' && threshold > 0 ? 'threshold' : 'kill'
}

export function parseSeasonOps(raw: unknown): SeasonOps {
  const value =
    typeof raw === 'string'
      ? (JSON.parse(raw || '{}') as Record<string, unknown>)
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : {}
  const threshold = (key: string) => {
    const parsed =
      typeof value[key] === 'number'
        ? value[key]
        : Number.parseFloat(String(value[key] ?? ''))
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
      ? parsed
      : null
  }
  const side1Threshold = threshold('sub1_kill_threshold_pct')
  const side2Threshold = threshold('sub2_kill_threshold_pct')
  const pingMode =
    value.ping_mode === 'combined' ||
    value.ping_mode === 'per_side' ||
    value.ping_mode === 'skip_all'
      ? value.ping_mode
      : null

  return {
    pingMode,
    mainNotes: parseSeasonNoteField(value.main_notes),
    side1Notes: parseSeasonNoteField(value.side1_notes),
    side2Notes: parseSeasonNoteField(value.side2_notes),
    side1Behaviour: normalizeSideBehaviour(
      value.sub1_skip === true,
      side1Threshold
    ),
    side2Behaviour: normalizeSideBehaviour(
      value.sub2_skip === true,
      side2Threshold
    ),
    side1ThresholdHpPct: side1Threshold,
    side2ThresholdHpPct: side2Threshold
  }
}
