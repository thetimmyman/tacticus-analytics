import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

const { dbMock, requireSessionUserMock } = vi.hoisted(() => ({
  dbMock: vi.fn(),
  requireSessionUserMock: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({ db: dbMock }))
vi.mock('@/app/lib/api/session-user', () => ({
  requireSessionUser: requireSessionUserMock
}))
vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: <Handler>(handler: Handler): Handler => handler
}))

import { GET } from '@/app/api/player/mentions-received/route'

describe('GET /api/player/mentions-received', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSessionUserMock.mockResolvedValue({ id: 'user-1' })
  })

  it('counts real delivered pings while excluding suppression and manual audits', async () => {
    const mappingSelect = vi.fn()
    const mappingEq = vi.fn()
    const mappingSingle = vi.fn().mockResolvedValue({
      data: {
        guild_code: 'EOT',
        primary_team: 'multi-hit',
        secondary_team: null,
        tertiary_team: null
      }
    })
    const mappingQuery = {
      select: mappingSelect,
      eq: mappingEq,
      single: mappingSingle
    }
    mappingSelect.mockReturnValue(mappingQuery)
    mappingEq.mockReturnValue(mappingQuery)

    const roleSelect = vi.fn()
    const roleEq = vi.fn()
    const roleIn = vi.fn().mockResolvedValue({
      data: [
        {
          discord_role_id: 'role-1',
          display_label: 'Multi-Hit',
          meta_team_slug: 'multi-hit'
        }
      ]
    })
    const roleQuery = { select: roleSelect, eq: roleEq, in: roleIn }
    roleSelect.mockReturnValue(roleQuery)
    roleEq.mockReturnValue(roleQuery)

    const logSelect = vi.fn()
    const logEq = vi.fn()
    const logGte = vi.fn()
    const logNot = vi.fn().mockImplementation(() => {
      const deliveredPing = { mentioned_roles: ['role-1'] }
      const suppressedAudit = { mentioned_roles: ['role-1'] }
      const manualAudit = { mentioned_roles: ['role-1'] }
      const excludesSuppressed = logEq.mock.calls.some(
        ([column, value]) =>
          column === 'suppressed_by_master_toggle' && value === false
      )
      const excludesManualOverrides = logEq.mock.calls.some(
        ([column, value]) => column === 'manual_override' && value === false
      )
      return Promise.resolve({
        data:
          excludesSuppressed && excludesManualOverrides
            ? [deliveredPing]
            : [deliveredPing, suppressedAudit, manualAudit]
      })
    })
    const logQuery = {
      select: logSelect,
      eq: logEq,
      gte: logGte,
      not: logNot
    }
    logSelect.mockReturnValue(logQuery)
    logEq.mockReturnValue(logQuery)
    logGte.mockReturnValue(logQuery)

    const from = vi.fn((table: string) => {
      if (table === 'player_mapping') return mappingQuery
      if (table === 'herald_meta_role_mapping') return roleQuery
      if (table === 'discord_webhook_logs') return logQuery
      throw new Error(`Unexpected table: ${table}`)
    })
    dbMock.mockResolvedValue({ from })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      mentions: [{ role: 'Multi-Hit', count: 1 }]
    })
    expect(logEq).toHaveBeenCalledWith('suppressed_by_master_toggle', false)
    expect(logEq).toHaveBeenCalledWith('manual_override', false)
  })
})
