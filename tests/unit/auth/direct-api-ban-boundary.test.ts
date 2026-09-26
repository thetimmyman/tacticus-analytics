import { readFileSync } from 'node:fs'
import { globSync } from 'glob'
import { describe, expect, it } from 'vitest'

describe('direct API authentication ban boundary', () => {
  it('requires every direct getUser route to assert the durable ban ledger', () => {
    const directAuthRoutes = globSync('app/api/**/route.ts').filter((file) =>
      readFileSync(file, 'utf8').includes('auth.getUser()')
    )

    expect(directAuthRoutes.length).toBeGreaterThan(0)
    for (const file of directAuthRoutes) {
      expect(
        readFileSync(file, 'utf8'),
        `${file} authenticates directly without enforcing user_bans`
      ).toContain('assertUnbannedAuthUser')
    }
  })

  it('forbids API routes from authenticating through page/optional helpers', () => {
    const routeFiles = globSync('app/api/**/route.ts')
    const forbiddenHelpers = [
      /\bgetCurrentUser\s*\(/,
      /\bgetAuthUser\s*\(/,
      /\bgetOptionalAuth\s*\(/
    ]

    for (const file of routeFiles) {
      const source = readFileSync(file, 'utf8')
      for (const helper of forbiddenHelpers) {
        expect(
          source,
          `${file} uses an authentication helper that does not enforce API bans`
        ).not.toMatch(helper)
      }
    }
  })

  it('keeps service-backed authenticated entry points behind the ban ledger', () => {
    const onboarding = readFileSync(
      'app/(public)/onboarding/dashboard/page.tsx',
      'utf8'
    )
    expect(onboarding).toContain('requireAuthAllowInactive()')
    expect(onboarding).not.toContain('auth.getUser()')

    const solver = readFileSync(
      'supabase/functions/boss-assignment-solver/solver-auth.ts',
      'utf8'
    )
    expect(solver).toContain('checkEffectiveBan(svc, caller, membership)')
  })
})
