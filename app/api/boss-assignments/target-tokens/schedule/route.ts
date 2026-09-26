/** Rotation schedule from the checked-in GlobalConfig.json (refresh via `npm run loki:season-lineups`). */

import { NextRequest, NextResponse } from 'next/server'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { requireAuthForApi } from '@/app/lib/auth'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { db } from '@/app/lib/db'
import {
  getSeasonConfigById,
  getSeasonConfigForSeasonNumber,
  getSeasonConfigIdForOffset,
  SEASON_CONFIGS,
  type SeasonBoss
} from '@/app/lib/loki/season-configs'
import { createComponentLogger } from '@/app/lib/logging'
import { parseSeasonParam } from '@/app/lib/boss-assignments/target-token-season'
const logger = createComponentLogger(
  'api.boss-assignments.target-tokens.schedule'
)

export const dynamic = 'force-dynamic'

interface SlotEntry {
  /** Raw Loki bossType; boss_target_tokens.boss_name stores this, not the display string. */
  boss_type: string
  boss_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounter_id: number
}

function bossToSlot(
  b: SeasonBoss,
  primeNameByKey: Map<string, string>,
  missingPrimeKeys: Set<string>
): SlotEntry | null {
  // Targets only apply to Legendary/Mythic.
  const rarity = (b as { rarity?: string }).rarity
  if (rarity !== 'Legendary' && rarity !== 'Mythic') return null

  // Loki repeats the main boss name for prime slots, so resolve primes via boss_mapping.
  let displayName = b.boss_name
  if (b.encounter_id > 0) {
    const key = `${b.boss_type}__${b.encounter_id}`
    const mapped = primeNameByKey.get(key)
    if (mapped) {
      displayName = mapped
    } else {
      missingPrimeKeys.add(key)
    }
  }

  return {
    boss_type: b.boss_type,
    boss_name: displayName,
    rarity,
    // Stored 0-indexed; emitted 1-indexed to match /boss-assignments URLs.
    set: b.set + 1,
    encounter_id: b.encounter_id
  }
}

function slotsFromConfig(
  bosses: SeasonBoss[],
  primeNameByKey: Map<string, string>,
  missingPrimeKeys: Set<string>
): SlotEntry[] {
  const out: SlotEntry[] = []
  bosses.forEach((b) => {
    const slot = bossToSlot(b, primeNameByKey, missingPrimeKeys)
    if (slot) out.push(slot)
  })
  return out
}

function dedupSlots(slots: SlotEntry[]): SlotEntry[] {
  const seen = new Set<string>()
  const out: SlotEntry[] = []
  for (const s of slots) {
    const key = `${s.boss_type}__${s.rarity}__${s.set}__${s.encounter_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    await requireAuthForApi()
    const requestedSeasonRaw = request.nextUrl.searchParams.get('season')
    const requestedSeason = parseSeasonParam(requestedSeasonRaw)
    if (
      requestedSeasonRaw !== null &&
      requestedSeasonRaw !== '' &&
      requestedSeason === null
    ) {
      throw Errors.fromStatus(400, 'season must be a positive integer string', {
        code: 'VALIDATION_ERROR'
      })
    }

    const primeNameByKey = new Map<string, string>()
    try {
      const supabase = await db()
      const { data: mappingRows } = await supabase
        .from('boss_mapping')
        .select('boss_type, encounter_index, boss_name')
      for (const row of mappingRows ?? []) {
        const bossType =
          typeof row?.boss_type === 'string' ? row.boss_type : null
        const encounterIndex =
          typeof row?.encounter_index === 'number' ? row.encounter_index : null
        const bossName =
          typeof row?.boss_name === 'string' ? row.boss_name : null
        if (
          !bossType ||
          encounterIndex === null ||
          encounterIndex <= 0 ||
          !bossName
        )
          continue
        primeNameByKey.set(`${bossType}__${encounterIndex}`, bossName)
      }
    } catch (err) {
      logger.warn(
        {
          error: err instanceof Error ? err.message : String(err)
        },
        'target-tokens/schedule: boss_mapping lookup failed, primes will use Loki names'
      )
    }

    const currentId = getSeasonConfigIdForOffset(0)
    const upcomingId = getSeasonConfigIdForOffset(1)

    const missingPrimeKeys = new Set<string>()
    const current = slotsFromConfig(
      getSeasonConfigById(currentId.id).bosses,
      primeNameByKey,
      missingPrimeKeys
    )
    const upcoming = slotsFromConfig(
      getSeasonConfigById(upcomingId.id).bosses,
      primeNameByKey,
      missingPrimeKeys
    )
    const requestedSeasonNumber = requestedSeason
      ? Number.parseInt(requestedSeason, 10)
      : null
    const selectedConfig =
      requestedSeasonNumber !== null
        ? (getSeasonConfigForSeasonNumber(requestedSeasonNumber) ??
          getSeasonConfigById(
            getSeasonConfigIdForOffset(
              requestedSeasonNumber - currentId.seasonNumber
            ).id
          ))
        : null
    const selected =
      requestedSeasonNumber !== null && selectedConfig
        ? {
            config_id: selectedConfig.id,
            season_number: requestedSeasonNumber,
            slots: slotsFromConfig(
              selectedConfig.bosses,
              primeNameByKey,
              missingPrimeKeys
            )
          }
        : null

    const allSlots: SlotEntry[] = []
    SEASON_CONFIGS.forEach((cfg) => {
      slotsFromConfig(cfg.bosses, primeNameByKey, missingPrimeKeys).forEach(
        (s) => allSlots.push(s)
      )
    })
    const all = dedupSlots(allSlots)

    if (missingPrimeKeys.size > 0) {
      logger.warn(
        {
          count: missingPrimeKeys.size,
          keys: Array.from(missingPrimeKeys).slice(0, 20)
        },
        'target-tokens/schedule: primes without boss_mapping — will render Loki name (possibly duplicate of main)'
      )
    }

    return NextResponse.json({
      current: {
        config_id: currentId.id,
        season_number: currentId.seasonNumber,
        slots: current
      },
      upcoming: {
        config_id: upcomingId.id,
        season_number: upcomingId.seasonNumber,
        slots: upcoming
      },
      selected,
      all: {
        slots: all,
        config_ids: SEASON_CONFIGS.map((c) => c.id)
      }
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in target-tokens/schedule GET:')
    throw Errors.fromStatus(500, 'Failed to load schedule', {
      code: 'INTERNAL_ERROR'
    })
  }
})
