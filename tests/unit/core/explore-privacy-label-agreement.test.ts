import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ANONYMOUS_PLAYER_LABEL } from '@tacticus/app-core/explore-privacy'

/** SQL cannot import the TS constant, so every privacy surface uses the exact label (counts pinned). */
const REPO_ROOT = resolve(__dirname, '../../..')
const TS_SOURCE_PATH = resolve(
  REPO_ROOT,
  'packages/app-core/src/explore-privacy.ts'
)
const SQL_CONTRACTS = [
  {
    name: '20260904020000_explore_privacy_view.sql',
    path: resolve(
      REPO_ROOT,
      'supabase/migrations/20260904020000_explore_privacy_view.sql'
    ),
    expectedOccurrences: 3
  },
  {
    name: '20260813000000_clean_baseline.sql',
    path: resolve(
      REPO_ROOT,
      'supabase/migrations/20260813000000_clean_baseline.sql'
    ),
    expectedOccurrences: 1
  },
  {
    name: '20260904100000_ps254_explore_obfuscation_percent.sql',
    path: resolve(
      REPO_ROOT,
      'supabase/migrations/20260904100000_ps254_explore_obfuscation_percent.sql'
    ),
    expectedOccurrences: 3
  },
  {
    name: '20260904140000_ps291_guild_total_carriers_obey_privacy.sql',
    path: resolve(
      REPO_ROOT,
      'supabase/migrations/20260904140000_ps291_guild_total_carriers_obey_privacy.sql'
    ),
    expectedOccurrences: 1
  }
] as const

type SqlContract = (typeof SQL_CONTRACTS)[number]

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

function stripSqlComments(source: string): string {
  return source.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function countOccurrences(source: string, value: string): number {
  let count = 0
  let offset = 0
  while (offset < source.length) {
    const found = source.indexOf(value, offset)
    if (found === -1) return count
    count += 1
    offset = found + value.length
  }
  return count
}

function countSqlStringLiteralOccurrences(
  source: string,
  label: string
): number {
  const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`
  return [label, JSON.stringify(label)].reduce(
    (count, value) => count + countOccurrences(source, sqlLiteral(value)),
    0
  )
}

function readTsLabel(source: string): string {
  const match = source.match(
    /export\s+const\s+ANONYMOUS_PLAYER_LABEL\s*=\s*(['"])([^'"]+)\1/
  )
  if (!match) throw new Error('anonymous player label declaration not found')
  return match[2]
}

function assertAnonymousPlayerLabelAgreement(
  label: string,
  contracts: readonly SqlContract[]
): void {
  for (const contract of contracts) {
    const executableSql = stripSqlComments(readSource(contract.path))
    const actual = countSqlStringLiteralOccurrences(executableSql, label)
    if (actual !== contract.expectedOccurrences) {
      throw new Error(
        `${contract.name}: expected ${contract.expectedOccurrences} executable occurrences of ${JSON.stringify(label)}, found ${actual}`
      )
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('PS-165 anonymous privacy-label agreement', () => {
  it('counts exact SQL string literals, not longer strings containing the label', () => {
    expect(
      countSqlStringLiteralOccurrences(
        `'Anonymous Warrior' 'Former Anonymous Warrior' '"Anonymous Warrior"'`,
        ANONYMOUS_PLAYER_LABEL
      )
    ).toBe(2)
  })

  it('matches the actual TypeScript constant in the current view and baseline', () => {
    const tsSource = readSource(TS_SOURCE_PATH)
    const label = readTsLabel(tsSource)

    expect(label).toBe(ANONYMOUS_PLAYER_LABEL)
    expect(() =>
      assertAnonymousPlayerLabelAgreement(label, SQL_CONTRACTS)
    ).not.toThrow()
  })

  it('fails when the TypeScript label is changed in a fixture copy', () => {
    const tsSource = readSource(TS_SOURCE_PATH)
    const declaration = new RegExp(
      `export\\s+const\\s+ANONYMOUS_PLAYER_LABEL\\s*=\\s*(['"])${escapeRegExp(ANONYMOUS_PLAYER_LABEL)}\\1`
    )
    const mutatedFixture = tsSource.replace(
      declaration,
      `export const ANONYMOUS_PLAYER_LABEL = ${JSON.stringify('Mutated Anonymous Label')}`
    )

    expect(mutatedFixture).not.toBe(tsSource)
    const mutatedLabel = readTsLabel(mutatedFixture)
    expect(mutatedLabel).not.toBe(ANONYMOUS_PLAYER_LABEL)
    expect(() =>
      assertAnonymousPlayerLabelAgreement(mutatedLabel, SQL_CONTRACTS)
    ).toThrow(/expected 3 executable occurrences.*found 0/)
  })
})
