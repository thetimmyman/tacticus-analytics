import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  getBossDisplayName,
  prettyBossName,
  BOSS_NAME_OVERRIDES,
  normalizeBossKey,
  stripNonAlnumLower
} from '@/app/lib/resolvers/boss-identity'
import { canonicalizeBossId } from '@/app/lib/loki/season-configs'

/** An unknown lowercase slug must not leak, so a rotation boss without display coverage fails CI. */

type JsonNode =
  string | number | boolean | null | JsonNode[] | { [key: string]: JsonNode }

function collectBossTypes(): string[] {
  const file = path.join(process.cwd(), 'data/loki-api/season-lineups.json')
  const data = JSON.parse(readFileSync(file, 'utf8')) as JsonNode
  const types = new Set<string>()
  const walk = (node: JsonNode): void => {
    if (!node || typeof node !== 'object') return
    if (!Array.isArray(node) && typeof node.bossType === 'string') {
      types.add(node.bossType)
    }
    Object.values(node).forEach(walk)
  }
  walk(data)
  return [...types].sort()
}

/** Not the coverage gate: the title-cased fallback makes any slug pass. */
const isFriendly = (name: string): boolean => /[A-Z]/.test(name)

/** Coverage gate: curated BOSS_NAME_OVERRIDES only, never the humanize fallback. */
const hasCuratedEntry = (token: string): boolean => {
  const exact = stripNonAlnumLower(token)
  const collapsed = normalizeBossKey(token)
  return Boolean(BOSS_NAME_OVERRIDES[exact] || BOSS_NAME_OVERRIDES[collapsed])
}

describe('rotation boss display coverage (data-driven)', () => {
  const bossTypes = collectBossTypes()

  it('season-lineups.json yields a non-trivial boss universe', () => {
    expect(bossTypes.length).toBeGreaterThanOrEqual(10)
  })

  it.each(bossTypes)(
    '%s has a curated BOSS_NAME_OVERRIDES entry (fallback rendering is a coverage gap)',
    (token) => {
      expect(
        hasCuratedEntry(token),
        `add '${stripNonAlnumLower(token)}' (or its normalizeBossKey form) to BOSS_NAME_OVERRIDES in app/lib/resolvers/boss-identity.ts — the humanize fallback would render a collapsed token, not the boss's real name`
      ).toBe(true)
      expect(hasCuratedEntry(canonicalizeBossId(token))).toBe(true)
    }
  )

  it.each(bossTypes)(
    'raw token %s renders friendly via both display functions',
    (token) => {
      expect(isFriendly(getBossDisplayName(token))).toBe(true)
      expect(isFriendly(prettyBossName(token))).toBe(true)
    }
  )

  it.each(bossTypes)(
    'canonical slug of %s renders friendly via both display functions',
    (token) => {
      const slug = canonicalizeBossId(token)
      expect(isFriendly(getBossDisplayName(slug))).toBe(true)
      expect(isFriendly(prettyBossName(slug))).toBe(true)
    }
  )

  it('regression: the exact PR #452 inputs', () => {
    expect(getBossDisplayName('rogaldorn')).toBe('Rogal Dorn')
    expect(prettyBossName('rogaldorn')).toBe('Rogal Dorn')
    expect(getBossDisplayName('magnus')).toBe('Magnus the Red')
    expect(prettyBossName('screamer_killer')).toBe('Screamer Killer')
  })
})
