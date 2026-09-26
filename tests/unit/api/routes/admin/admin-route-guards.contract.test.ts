import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

// Every app/api/admin route uses `withAdminGuards`: no skipped rate limit, no guild-rank gate.
function runScript(flag: string): { status: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      ['scripts/security/check-admin-route-guards.mjs', flag],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    return { status: 0, output }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: err.status ?? 1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
  }
}

describe('app/api/admin route guards', () => {
  it('passes its own detector self-test', () => {
    const { status, output } = runScript('--selftest')
    expect(output).not.toContain('FAIL')
    expect(status).toBe(0)
  })

  it('has every route wrapped in withAdminGuards and rate limited', () => {
    const { status, output } = runScript('--scan')
    expect(output).toMatch(/(\d+)\/\1 routes wrapped/)
    expect(status).toBe(0)
  })

  it('reports every route on the limiter in the census', () => {
    const { status, output } = runScript('--census')
    expect(status).toBe(0)

    const limiter = output.match(
      /(\d+) of (\d+) routes apply the '\/api\/admin\/' rate limiter/
    )
    expect(limiter).not.toBeNull()
    const [, applied, total] = limiter as RegExpMatchArray
    expect(Number(total)).toBeGreaterThanOrEqual(28)
    expect(applied).toBe(total)

    expect(output).not.toMatch(/\bnone\b/)
  })

  it('keeps the list of routes NOT gated on the app-admin predicate explicit', () => {
    const { output } = runScript('--census')

    const nonAppAdmin = output
      .split('\n')
      .filter((line) => /^app\/api\/admin\//.test(line))
      .filter((line) => !/\bapp-admin(-user-id|-session)?\b/.test(line))
      .map((line) => line.split(/\s{2,}/)[0])

    // Both are own-guild and require a `reason`; anything else is a guild rank standing in for an app role.
    expect(nonAppAdmin.sort()).toEqual([
      'app/api/admin/player-api-key/route.ts',
      'app/api/admin/support-draft/route.ts'
    ])
  })
})
