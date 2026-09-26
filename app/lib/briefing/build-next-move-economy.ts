/**
 * Matches on `boss_type`, then `canonical` for short EOT names. Unmatched bosses
 * get `value: null` and never justify a hold.
 */

import type { NextMoveAlternative } from './types'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

export interface BossValueRow {
  bossName: string
  encounterId: number
  yourAvg: number | null
}

export interface UpcomingMain {
  /** Fallback match key only. */
  name: string
  bossType: string
  displayName: string
  stageCode: string
  loopIndex: number
  etaSeconds: number
  etaSource: 'history' | 'estimate'
}

export interface NextMoveEconomyInputs {
  currentBossValue: number | null
  alternatives: NextMoveAlternative[]
}

const normalizeBossKey = normalizeIdentifier

export function prettifyCanonical(canonical: string): string {
  const cleaned = canonical.replace(/[_-]+/g, ' ').trim()
  if (!cleaned) return canonical
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function buildValueMap(valueRows: BossValueRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of valueRows) {
    if (r.encounterId !== 0) continue
    if (r.yourAvg == null || !Number.isFinite(r.yourAvg)) continue
    const key = normalizeBossKey(r.bossName)
    if (!key) continue
    if (!map.has(key)) map.set(key, r.yourAvg)
  }
  return map
}

export function buildNextMoveEconomyInputs(args: {
  currentBossName: string | null | undefined
  valueRows: BossValueRow[]
  upcomingMains: UpcomingMain[]
}): NextMoveEconomyInputs {
  const valueMap = buildValueMap(args.valueRows)
  const valueOf = (
    ...candidates: Array<string | null | undefined>
  ): number | null => {
    for (const c of candidates) {
      const key = normalizeBossKey(c)
      if (key && valueMap.has(key)) return valueMap.get(key)!
    }
    return null
  }

  const currentBossValue = valueOf(args.currentBossName)

  const alternatives: NextMoveAlternative[] = args.upcomingMains.map((m) => ({
    name: m.name,
    displayName: m.displayName || prettifyCanonical(m.name),
    levelCode: m.stageCode,
    encounterId: 0,
    value: valueOf(m.bossType, m.name),
    etaSeconds: m.etaSeconds,
    etaSource: m.etaSource
  }))

  return { currentBossValue, alternatives }
}
