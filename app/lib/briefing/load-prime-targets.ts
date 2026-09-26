/** `undefined` = unavailable (legacy warded hold); `[]` = no live targets. */

import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { parseSeasonOps } from '@/app/lib/boss-ops/season-ops'
import type { LandingPageBossOverview } from '@/app/lib/dashboard/home-summary-types'
import { resolvePrimeTargets, type PrimeBossPair } from './prime-targets'
import type { PrimeTarget } from './types'

const logger = createComponentLogger('briefing.prime-targets')

interface LoadArgs {
  guildCode: string | undefined
  season: string
  currentBoss: Pick<LandingPageBossOverview, 'levelCode'> | undefined
  primeBosses: PrimeBossPair | undefined
}

export async function loadPrimeTargets(
  args: LoadArgs
): Promise<PrimeTarget[] | undefined> {
  const { guildCode, season, currentBoss, primeBosses } = args
  if (!primeBosses || (!primeBosses.prime1 && !primeBosses.prime2)) {
    return undefined
  }
  if (!guildCode || !season) return undefined

  const difficultyCode = currentBoss?.levelCode ?? ''
  if (!/^[LM][1-5]$/.test(difficultyCode)) return undefined

  try {
    const supabase = await db()
    const { data, error } = await supabase
      .from('upcoming_season_bosses')
      .select('sub_bosses')
      .eq('guild_code', guildCode)
      .eq('season_number', String(season))
      .eq('level', difficultyCode)
      .maybeSingle()

    if (error) {
      logger.warn(
        { error: error.message },
        'prime-targets: season-ops lookup failed'
      )
      return undefined
    }

    const ops =
      data && typeof data === 'object'
        ? parseSeasonOps((data as { sub_bosses?: unknown }).sub_bosses)
        : null

    return resolvePrimeTargets(primeBosses, ops, difficultyCode)
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'prime-targets: season-ops lookup threw'
    )
    return undefined
  }
}

export async function loadPrimeTargetsWithTimeout(
  args: LoadArgs,
  timeoutMs = 3000
): Promise<PrimeTarget[] | undefined> {
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), timeoutMs)
  )
  return Promise.race([loadPrimeTargets(args).catch(() => undefined), timeout])
}
