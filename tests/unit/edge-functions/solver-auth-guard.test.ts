import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const handlerSource = readFileSync(
  join(
    __dirname,
    '../../../supabase/functions/boss-assignment-solver/handler.ts'
  ),
  'utf8'
)
const authSource = readFileSync(
  join(
    __dirname,
    '../../../supabase/functions/boss-assignment-solver/solver-auth.ts'
  ),
  'utf8'
)

describe('boss-assignment-solver guild isolation', () => {
  it('authorizes the requested guild before any guild-scoped read', () => {
    const authorization = handlerSource.indexOf(
      'await authorizeSolverGuildRequest(req, guildCode)'
    )
    expect(authorization).toBeGreaterThan(-1)
    expect(authorization).toBeLessThan(
      handlerSource.indexOf('await fetchBossConfig(')
    )
    expect(handlerSource).toContain(
      'if (authorizationError) return authorizationError'
    )
  })

  it('uses the shared fail-closed service-role guard', () => {
    expect(authSource).toContain('requireServiceRole(req) === null')
    expect(authSource).not.toMatch(/Bearer \$\{serviceKey\}/)
  })

  it('requires a bearer token before resolving a caller', () => {
    const jwtRejection = authSource.indexOf(
      "if (!jwt) return errorResponse('Authentication required', 401)"
    )
    const getUserCall = authSource.indexOf('await svc.auth.getUser(jwt)')
    expect(jwtRejection).toBeGreaterThan(-1)
    expect(getUserCall).toBeGreaterThan(jwtRejection)
  })

  it('rejects unresolved callers before membership lookup', () => {
    const callerRejection = authSource.indexOf(
      "return errorResponse('Authentication required', 401)",
      authSource.indexOf('await svc.auth.getUser(jwt)')
    )
    expect(callerRejection).toBeGreaterThan(-1)
    expect(authSource.indexOf(".from('player_mapping')")).toBeGreaterThan(
      callerRejection
    )
  })

  it('logs identity-resolution failures', () => {
    expect(authSource).toContain(
      "logger.warn('Guild isolation could not resolve the caller token'"
    )
  })

  it('keeps cross-guild membership mismatch as a 403', () => {
    expect(authSource).toContain(
      'guildCodesEqual(membership.guild_code, guildCode)'
    )
    expect(authSource).toContain(
      "return errorResponse('You do not have access to this guild', 403)"
    )
  })
})
