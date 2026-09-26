import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** `select('*')` would leak extra profile columns into the RSC payload; the leak is type-invisible. */
const AUTH_TS = readFileSync(
  join(process.cwd(), 'app/lib/auth/index.ts'),
  'utf8'
)

// No profile projection may return credential ciphertext or private notes.
const WITHHELD_COLUMNS = [
  'tacticus_api_key_encrypted',
  'officer_notes',
  'player_notes',
  'patreon_user_id'
] as const

function activeProfileSelectColumns(): string[] {
  const start = AUTH_TS.indexOf('const ACTIVE_PROFILE_SELECT = [')
  expect(
    start,
    'ACTIVE_PROFILE_SELECT should exist in app/lib/auth/index.ts'
  ).toBeGreaterThan(-1)
  const body = AUTH_TS.slice(start, AUTH_TS.indexOf("].join(',')", start))
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
}

describe('resolveProfile column whitelist (WI-5915)', () => {
  it('never selects * from player_mapping', () => {
    expect(AUTH_TS).not.toMatch(/\.select\('\*'\)/)
  })

  it('withholds every column authenticated cannot read', () => {
    const columns = activeProfileSelectColumns()
    for (const withheld of WITHHELD_COLUMNS) {
      expect(
        columns,
        `${withheld} must not be in ACTIVE_PROFILE_SELECT`
      ).not.toContain(withheld)
    }
  })

  it('matches the 50 columns exposed by the self-only profile view', () => {
    // Under-selecting degrades consumers; over-selecting re-opens the leak.
    expect(activeProfileSelectColumns()).toHaveLength(50)
  })

  it('uses the whitelist on every full-profile read', () => {
    const selects = [
      ...AUTH_TS.matchAll(
        /\.from\('player_mapping'\)\s*\n\s*\.select\(([^)]+)\)/g
      )
    ]
    expect(
      selects.length,
      'expected the service-side profile reads to be found'
    ).toBeGreaterThanOrEqual(2)
    for (const [, arg] of selects) {
      expect(arg.trim()).toBe('ACTIVE_PROFILE_SELECT')
    }
    expect(AUTH_TS).toMatch(
      /\.from\(CURRENT_USER_PLAYER_MAPPING\)\s*\n\s*\.select\(ACTIVE_PROFILE_SELECT\)/
    )
  })
})

describe('consumers do not read withheld columns off the profile (WI-5915)', () => {
  // These read the encrypted key for badges; the whitelist omits it, silently pinning users low.
  const CONSUMERS = [
    'app/lib/dashboard/home-summary-rpc.ts',
    'app/lib/dashboard/guild-summary.ts'
  ]

  it.each(CONSUMERS)('%s reads a granted column instead', (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8')
    const codeOnly = source
      .split('\n')
      .filter(
        (line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')
      )
      .join('\n')

    for (const withheld of WITHHELD_COLUMNS) {
      expect(
        codeOnly,
        `${relativePath} must not read ${withheld}`
      ).not.toContain(`profile.${withheld}`)
    }
    expect(codeOnly).toContain('api_key_last_verified')
  })
})
