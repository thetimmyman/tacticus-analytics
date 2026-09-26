import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  normalizeSeasonConfigKillThresholdPct,
  normalizeSeasonConfigBaseInput,
  normalizeSeasonConfigSubIndex,
  type SeasonConfigSubIndex
} from '../_write-helpers'
import {
  authorizeSeasonConfigWrite,
  persistSeasonConfigPatch
} from '../_write-route'

const logger = createComponentLogger('season-config-skip-prime')

// Inline edits only; full saves use manage_season_assignments (needs the whole state).

interface SkipPrimeInput {
  guild_code: string
  season_number: string
  level: string // raritySet, e.g. "L4"
  sub_index: SeasonConfigSubIndex // 1 = prime1, 2 = prime2
  skip: boolean
  /** When present, skip and threshold land in one atomic merge. */
  kill_threshold_pct?: number
}

const normalizeInput = (body: unknown): SkipPrimeInput | null => {
  const normalized = normalizeSeasonConfigBaseInput(body)
  if (!normalized) return null
  const { input, raw } = normalized
  const subIndex = normalizeSeasonConfigSubIndex(raw.sub_index)
  const skip = raw.skip === true
  if (!subIndex) return null
  const base: SkipPrimeInput = {
    ...input,
    sub_index: subIndex,
    skip
  }
  // Absent: leave the threshold alone (legacy callers).
  if (raw.kill_threshold_pct === undefined) return base
  const pct = normalizeSeasonConfigKillThresholdPct(raw.kill_threshold_pct)
  if (pct === null) return null
  return { ...base, kill_threshold_pct: pct }
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const endpoint = '/api/season-config/skip-prime'
  const { input, supabase, user } = await authorizeSeasonConfigWrite(req, {
    endpoint,
    normalizeInput,
    validationMessage:
      'guild_code, season_number, level (L1..M5), sub_index (1 or 2), and skip (boolean) are required'
  })
  const skipKey = `sub${input.sub_index}_skip`
  const patch: Record<string, unknown> = { [skipKey]: input.skip }
  if (input.kill_threshold_pct !== undefined) {
    patch[`sub${input.sub_index}_kill_threshold_pct`] = input.kill_threshold_pct
  }
  await persistSeasonConfigPatch({
    endpoint,
    supabase,
    selectedBy: user.id,
    input,
    patch,
    failures: {
      lookup: 'Failed to look up existing season row',
      update: 'Failed to update skip-prime flag',
      insert: 'Failed to create season row for skip-prime flag'
    }
  })

  logger.info(
    {
      guild_code: input.guild_code,
      season_number: input.season_number,
      level: input.level,
      sub_index: input.sub_index,
      skip: input.skip
    },
    'season_config.skip_prime.saved'
  )
  return NextResponse.json({ success: true })
})
