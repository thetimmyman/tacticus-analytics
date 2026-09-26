'use client'

/**
 * Live cap budget for battle tokens and raid bombs. Regen runs only below cap, so time
 * spent full pushes units past the season deadline. Null until the window resolves.
 */

import { useEffect, useState } from 'react'
import { useBaseQuery } from '@/app/lib/hooks/shared/useBaseQuery'
import {
  ageResourceSnapshot,
  BOMB_RESOURCE,
  computeCapBudget,
  seasonMaxForWindow,
  TOKEN_RESOURCE,
  type CapBudgetResult,
  type EconomyResource
} from '@/app/lib/calculations/cap-budget'
import { SEASON_END_LOCKOUT_SECONDS } from '@/app/lib/calculations/token-calculation'
import type { TokenAvailability } from '@/app/components/playerstats/types'

interface SeasonTimingResponse {
  seasonNumber: number
  seasonStart: number
  seasonEnd: number
  source: string
}

export interface SeasonWindow {
  startMs: number
  endMs: number
}

export interface PlayerCapBudget extends CapBudgetResult {
  /** Bank projected to now; rollover can exceed the fetched value. */
  bankNow: number
  /** Null at the cap or without a clock. */
  nextRegenSeconds: number | null
}

export interface PlayerEconomyBudget {
  tokens: PlayerCapBudget | null
  bombs: PlayerCapBudget | null
}

export function useSeasonWindow(season: string): SeasonWindow | null {
  const seasonNumber = Number.parseInt(season, 10)
  const hasSeason = Number.isFinite(seasonNumber) && seasonNumber > 0

  const query = useBaseQuery<SeasonTimingResponse>({
    queryKey: ['season-timing', hasSeason ? seasonNumber : 'current'],
    queryFn: () =>
      fetch(
        hasSeason
          ? `/api/season/timing?season=${seasonNumber}`
          : '/api/season/timing'
      ).then((r) => {
        if (!r.ok) throw new Error('Failed to fetch season timing')
        return r.json()
      }),
    cacheDuration: 5 * 60 * 1000,
    retryCount: 1
  })

  const seasonStart = query.data?.seasonStart
  const seasonEnd = query.data?.seasonEnd
  return typeof seasonStart === 'number' &&
    Number.isFinite(seasonStart) &&
    typeof seasonEnd === 'number' &&
    Number.isFinite(seasonEnd)
    ? { startMs: seasonStart, endMs: seasonEnd }
    : null
}

/** Epoch ms re-read each second; null on the server and first render for clean hydration. */
export function useTickingNowMs(enabled: boolean): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setNowMs(null)
      return
    }
    setNowMs(Date.now())
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [enabled])

  return nowMs
}

function budgetFor(args: {
  resource: EconomyResource
  bankAtFetch: number
  nextRegenSecondsAtFetch: number | null
  used: number
  elapsedSeconds: number
  secondsToDeadline: number
  window: SeasonWindow
}): PlayerCapBudget {
  const aged = ageResourceSnapshot(
    args.bankAtFetch,
    args.nextRegenSecondsAtFetch,
    args.elapsedSeconds,
    args.resource
  )
  const budget = computeCapBudget({
    bankNow: aged.bankNow,
    nextRegenSeconds: aged.nextRegenSeconds,
    secondsToDeadline: args.secondsToDeadline,
    used: args.used,
    seasonMax: seasonMaxForWindow(
      args.window.startMs,
      args.window.endMs,
      args.resource
    ),
    resource: args.resource
  })
  return { ...budget, ...aged }
}

export interface SeasonSpend {
  tokens: number
  bombs: number
}

/**
 * Spend counts are passed in because two RPCs count the season; numerator and
 * budget must use the same one.
 */
export function usePlayerEconomyBudget(
  tokenAvailability: TokenAvailability | null,
  season: string,
  used: SeasonSpend
): PlayerEconomyBudget {
  const window = useSeasonWindow(season)
  const nowMs = useTickingNowMs(Boolean(tokenAvailability) && window != null)

  if (!tokenAvailability || window == null || nowMs == null) {
    return { tokens: null, bombs: null }
  }

  const elapsedSeconds =
    tokenAvailability.fetchedAtMs != null
      ? (nowMs - tokenAvailability.fetchedAtMs) / 1000
      : 0

  // Battles lock in the last 15 minutes, so that is the spend deadline.
  const deadlineMs = window.endMs - SEASON_END_LOCKOUT_SECONDS * 1000
  const secondsToDeadline = Math.floor((deadlineMs - nowMs) / 1000)

  return {
    tokens: budgetFor({
      resource: TOKEN_RESOURCE,
      bankAtFetch: tokenAvailability.tokens,
      nextRegenSecondsAtFetch: tokenAvailability.nextTokenSeconds ?? null,
      used: used.tokens,
      elapsedSeconds,
      secondsToDeadline,
      window
    }),
    bombs: budgetFor({
      resource: BOMB_RESOURCE,
      bankAtFetch: tokenAvailability.bombs,
      nextRegenSecondsAtFetch: tokenAvailability.nextBombSeconds ?? null,
      used: used.bombs,
      elapsedSeconds,
      secondsToDeadline,
      window
    })
  }
}
