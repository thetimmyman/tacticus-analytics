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

const logger = createComponentLogger('season-config-kill-threshold')

// 0 = defeat at HP=0; >0 = defeat once remainingHp <= maxHp * pct / 100.

interface KillThresholdInput {
  guild_code: string
  season_number: string
  level: string // raritySet, e.g. "L4"
  sub_index: SeasonConfigSubIndex // 1 = prime1, 2 = prime2
  kill_threshold_pct: number // 0-100
}

const normalizeInput = (body: unknown): KillThresholdInput | null => {
  const normalized = normalizeSeasonConfigBaseInput(body)
  if (!normalized) return null
  const { input, raw } = normalized
  const subIndex = normalizeSeasonConfigSubIndex(raw.sub_index)
  const pct = normalizeSeasonConfigKillThresholdPct(raw.kill_threshold_pct)
  if (!subIndex) return null
  if (pct === null) return null
  return {
    ...input,
    sub_index: subIndex,
    kill_threshold_pct: pct
  }
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const endpoint = '/api/season-config/kill-threshold'
  const { input, supabase, user } = await authorizeSeasonConfigWrite(req, {
    endpoint,
    normalizeInput,
    validationMessage:
      'guild_code, season_number, level (L1..M5), sub_index (1 or 2), and kill_threshold_pct (0-100) are required'
  })
  const fieldKey = `sub${input.sub_index}_kill_threshold_pct`
  await persistSeasonConfigPatch({
    endpoint,
    supabase,
    selectedBy: user.id,
    input,
    patch: { [fieldKey]: input.kill_threshold_pct },
    failures: {
      lookup: 'Failed to look up existing season row',
      update: 'Failed to update kill-threshold',
      insert: 'Failed to create season row for kill-threshold'
    }
  })

  logger.info(
    {
      guild_code: input.guild_code,
      season_number: input.season_number,
      level: input.level,
      sub_index: input.sub_index,
      kill_threshold_pct: input.kill_threshold_pct
    },
    'season_config.kill_threshold.saved'
  )
  return NextResponse.json({ success: true })
})
