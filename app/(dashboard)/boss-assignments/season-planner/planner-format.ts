'use client'

import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { formatSeasonDateTime } from '@/app/lib/season-date/date-format'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { PlannedSession } from '@/app/lib/boss-assignments/season-planner/planner-engine'
import type {
  FetchErrorPayload,
  RosterStrategyMember,
  StrategyPlanDelta,
  StrategyPlanSummary
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'

// Dev-only raw-JSON dump; NODE_ENV is inlined at build.
export const IS_DEV = process.env.NODE_ENV !== 'production'

// Rows before "Show all"; the cap and the toggle check live in different files and MUST share this.
export const STAGE_TIMELINE_PAGE_SIZE = 120

// Valid IANA zones only: an invalid zone would 500 in new Intl.DateTimeFormat.
export const IANA_TIME_ZONES: string[] = (() => {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf
    const zones =
      typeof supported === 'function' ? supported.call(Intl, 'timeZone') : []
    return Array.from(new Set(['UTC', ...zones]))
  } catch {
    return ['UTC']
  }
})()

export const resolveBrowserTimeZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export const parseBoundedIntInput = (
  value: string,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < min) return fallback
  return Math.min(max, parsed)
}

// Explicit timeZone, hour12:false, invalid -> raw iso; the caller applies hasMounted.
export const formatDateTime = formatSeasonDateTime

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init)
  const body = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const payload = body as FetchErrorPayload | null
    throw new Error(
      extractErrorMessage(
        payload,
        payload?.details || `Request failed (${res.status})`
      )
    )
  }
  return body as T
}

export const sumSessionTokens = (sessions: PlannedSession[]) =>
  sessions.reduce(
    (acc, session) => {
      acc.spent += session.tokensSpent ?? 0
      acc.held += session.tokensHeld ?? 0
      return acc
    },
    { spent: 0, held: 0 }
  )

export const signedNumber = (
  value: number,
  formatter = formatNumber
): string => {
  const rounded = Math.round(value)
  return `${rounded >= 0 ? '+' : ''}${formatter(rounded)}`
}

export const signedDecimal = (value: number): string =>
  `${value >= 0 ? '+' : ''}${Math.round(value * 10) / 10}`

export const deltaClass = (value: number): string => {
  if (value > 0) return 'text-green-300'
  if (value < 0) return 'text-red-300'
  return 'text-secondary-wh40k'
}

export const compareStrategyMembers = (
  a: RosterStrategyMember,
  b: RosterStrategyMember
): number =>
  a.displayName.localeCompare(b.displayName, undefined, {
    sensitivity: 'base'
  }) || a.guildCode.localeCompare(b.guildCode)

export const compactSummaryMetric = (summary: StrategyPlanSummary) => [
  { label: 'Clears', value: formatNumber(summary.bossesDefeated) },
  { label: 'Loops', value: formatNumber(summary.loopAdvances) },
  { label: 'Spent', value: formatNumber(summary.tokensSpent) },
  { label: 'Damage/token', value: formatNumber(summary.tokenEfficiency) }
]

export const strategyDeltaMetric = (delta: StrategyPlanDelta) => [
  { label: 'Clears', value: signedNumber(delta.bossesDefeated) },
  { label: 'Loops', value: signedNumber(delta.loopAdvances) },
  { label: 'Damage/token', value: signedNumber(delta.tokenEfficiency) },
  { label: 'Score', value: signedDecimal(delta.score) }
]
