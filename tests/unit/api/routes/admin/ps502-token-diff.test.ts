// Leak probe: the decrypted key and raw upstream payload never reach a response or log.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Errors as ErrorsType } from '@/app/lib/errors/AppError'

const KEY_MARKER = 'PLANTED-DECRYPTED-KEY-8f3a2b1c'
const PAYLOAD_MARKER = 'PLANTED-RAW-PAYLOAD-b21c9d4e'
const MARKERS = [KEY_MARKER, PAYLOAD_MARKER]

function assertNoMarkers(text: string, where: string): void {
  for (const marker of MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`leak: ${marker} appeared in ${where}`)
    }
  }
}

const GUILD = 'australian-bogans-retreat'
const SEASON = 107

let mockRequireAppAdmin: ReturnType<typeof vi.fn>
let mockDecryptApiKey: ReturnType<typeof vi.fn>
let mockGetGuildRaidBySeason: ReturnType<typeof vi.fn>
let logCalls: unknown[][]
let guildConfigResult: { data: unknown; error: unknown }
let landedResult: { data: unknown; error: unknown }
let Errors: typeof ErrorsType

const upstreamPayload = () => ({
  season: String(SEASON),
  entries: [
    {
      userId: 'user-a',
      // The transform must drop the payload marker, never echo it.
      displayName: PAYLOAD_MARKER,
      heroDetails: { note: PAYLOAD_MARKER },
      type: 'Szarekh',
      encounterIndex: 3,
      tier: 4,
      set: 2,
      damageDealt: 1000,
      damageType: 'Battle',
      startedOn: '2026-08-25T12:00:00.000Z',
      completedOn: '2026-08-25T12:00:30.000Z',
      maxHp: 10,
      remainingHp: 0
    },
    {
      userId: 'user-a',
      displayName: PAYLOAD_MARKER,
      type: 'Szarekh',
      encounterIndex: 3,
      // Differs only in tier/set, which the unique index excludes.
      tier: 5,
      set: 3,
      damageDealt: 1000,
      damageType: 'Battle',
      startedOn: '2026-08-25T12:00:00.000Z',
      completedOn: '2026-08-25T12:00:30.000Z',
      maxHp: 10,
      remainingHp: 0
    }
  ]
})

const landedRow = () => ({
  Guild: GUILD,
  Season: String(SEASON),
  userId: 'user-a',
  encounterId: 3,
  startedOn: '2026-08-25T12:00:00.000Z',
  completedOn: '2026-08-25T12:00:30.000Z',
  damageDealt: 1000,
  damageType: 'Battle'
})

function makeSupabase() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      for (const method of ['select', 'eq', 'gte', 'lt', 'order', 'limit']) {
        builder[method] = vi.fn(chain)
      }
      builder.maybeSingle = vi.fn(async () => guildConfigResult)
      builder.then = (
        resolve: (value: { data: unknown; error: unknown }) => unknown
      ) => Promise.resolve(landedResult).then(resolve)
      return table === 'guild_config' ? builder : builder
    }
  }
}

async function loadRoute() {
  return (await import('@/app/api/admin/diagnostics/ps502-token-diff/route'))
    .GET as (request: NextRequest) => Promise<Response>
}

const makeRequest = (query = `guild=${GUILD}&season=${SEASON}`) =>
  new NextRequest(
    `http://localhost/api/admin/diagnostics/ps502-token-diff?${query}`
  )

const loggedText = () =>
  logCalls
    .map((args) =>
      args
        .map((a) => {
          try {
            return typeof a === 'string' ? a : JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join(' ')
    )
    .join('\n')

describe('GET /api/admin/diagnostics/ps502-token-diff', () => {
  beforeEach(async () => {
    vi.resetModules()
    logCalls = []

    const errorModule = await import('@/app/lib/errors/AppError')
    Errors = errorModule.Errors

    mockRequireAppAdmin = vi.fn().mockResolvedValue({ profile: {} })
    mockDecryptApiKey = vi.fn().mockResolvedValue(KEY_MARKER)
    mockGetGuildRaidBySeason = vi.fn().mockResolvedValue(upstreamPayload())
    guildConfigResult = {
      data: { guild_code: GUILD, api_key_encrypted: 'ciphertext' },
      error: null
    }
    landedResult = { data: [landedRow()], error: null }

    const capture =
      () =>
      (...args: unknown[]) => {
        logCalls.push(args)
      }
    const fakeLogger = {
      info: capture(),
      warn: capture(),
      error: capture(),
      debug: capture(),
      trace: capture(),
      fatal: capture(),
      child: () => fakeLogger
    }

    vi.doMock('@/app/lib/auth/app-admin', () => ({
      requireAppAdminForApi: mockRequireAppAdmin
    }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      decryptApiKey: mockDecryptApiKey
    }))
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: { getGuildRaidBySeason: mockGetGuildRaidBySeason }
    }))
    vi.doMock('@/app/lib/db', () => ({ serviceDb: () => makeSupabase() }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => fakeLogger,
      logger: fakeLogger,
      logError: capture(),
      generateRequestId: () => 'req-test'
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSITIVE CONTROL: the leak probe fails on a planted marker', () => {
    expect(() =>
      assertNoMarkers(`prefix ${KEY_MARKER} suffix`, 'control string')
    ).toThrow(/leak: PLANTED-DECRYPTED-KEY/)
    expect(() =>
      assertNoMarkers(`prefix ${PAYLOAD_MARKER} suffix`, 'control string')
    ).toThrow(/leak: PLANTED-RAW-PAYLOAD/)
    expect(() => assertNoMarkers('clean text', 'control string')).not.toThrow()
  })

  it('refuses an unauthenticated request and never decrypts', async () => {
    mockRequireAppAdmin.mockRejectedValue(Errors.unauthorized('Unauthorized'))

    const response = await (await loadRoute())(makeRequest())

    expect(response.status).toBe(401)
    expect(mockDecryptApiKey).not.toHaveBeenCalled()
    expect(mockGetGuildRaidBySeason).not.toHaveBeenCalled()
  })

  it('refuses a non-admin request and never decrypts', async () => {
    mockRequireAppAdmin.mockRejectedValue(
      Errors.forbidden('Admin access required')
    )

    const response = await (await loadRoute())(makeRequest())

    expect(response.status).toBe(403)
    expect(mockDecryptApiKey).not.toHaveBeenCalled()
    expect(mockGetGuildRaidBySeason).not.toHaveBeenCalled()
  })

  it('returns counts and unmatched 8-tuples, and leaks nothing on success', async () => {
    const response = await (await loadRoute())(makeRequest())
    const text = await response.text()

    expect(response.status).toBe(200)
    assertNoMarkers(text, 'success response body')
    assertNoMarkers(loggedText(), 'logs on the success path')

    const body = JSON.parse(text)
    expect(body.upstreamRowCount).toBe(2)
    expect(body.landedRowCount).toBe(1)
    expect(body.unmatchedUpstreamRows).toHaveLength(1)
    expect(body.upstreamDuplicateKeyGroups).toHaveLength(1)
    expect(Object.keys(body.unmatchedUpstreamRows[0]).sort()).toEqual([
      'Guild',
      'Season',
      'completedOn',
      'damageDealt',
      'damageType',
      'encounterId',
      'startedOn',
      'userId'
    ])
    expect(mockDecryptApiKey).toHaveBeenCalledWith('ciphertext')
    expect(mockGetGuildRaidBySeason).toHaveBeenCalledWith(KEY_MARKER, SEASON)
  })

  it('rejects a bad guild id before touching the credential', async () => {
    const response = await (await loadRoute())(makeRequest('season=107'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'invalid_request' }
    })
    expect(mockDecryptApiKey).not.toHaveBeenCalled()
  })

  it('returns guild_not_found for an unknown guild', async () => {
    guildConfigResult = { data: null, error: null }

    const response = await (
      await loadRoute()
    )(makeRequest('guild=no-such-guild&season=107'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'guild_not_found', message: 'guild_not_found' }
    })
    expect(mockDecryptApiKey).not.toHaveBeenCalled()
  })

  it('leaks nothing when the decrypt itself throws with the key in the message', async () => {
    mockDecryptApiKey.mockRejectedValue(
      new Error(`decrypt failed for key ${KEY_MARKER}`)
    )

    const response = await (await loadRoute())(makeRequest())
    const text = await response.text()

    assertNoMarkers(text, 'decrypt-failure response body')
    assertNoMarkers(loggedText(), 'logs on the decrypt-failure path')
    expect(response.status).toBe(502)
    expect(JSON.parse(text)).toEqual({
      error: { code: 'key_unavailable', message: 'key_unavailable' }
    })
  })

  it('leaks nothing when upstream rejects with the payload in the message', async () => {
    mockGetGuildRaidBySeason.mockRejectedValue(
      new Error(`upstream 500 body=${PAYLOAD_MARKER} key=${KEY_MARKER}`)
    )

    const response = await (await loadRoute())(makeRequest())
    const text = await response.text()

    assertNoMarkers(text, 'upstream-failure response body')
    assertNoMarkers(loggedText(), 'logs on the upstream-failure path')
    expect(response.status).toBe(500)
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal_error', message: 'internal_error' }
    })
  })

  it('returns upstream_unavailable (and leaks nothing) when the client returns null', async () => {
    mockGetGuildRaidBySeason.mockResolvedValue(null)

    const response = await (await loadRoute())(makeRequest())
    const text = await response.text()

    expect(response.status).toBe(502)
    expect(JSON.parse(text)).toEqual({
      error: { code: 'upstream_unavailable', message: 'upstream_unavailable' }
    })
    assertNoMarkers(loggedText(), 'logs on the upstream-null path')
  })

  it('PS-502 fix: returns diff_invariant_violated (not a 200) when the diff is arithmetically impossible', async () => {
    landedResult = {
      data: [
        {
          Guild: GUILD,
          Season: String(SEASON),
          userId: 'user-z-does-not-match-upstream',
          encounterId: 999,
          startedOn: '2026-08-25T12:00:00.000Z',
          completedOn: '2026-08-25T12:00:30.000Z',
          damageDealt: 1,
          damageType: 'Battle'
        }
      ],
      error: null
    }

    const response = await (await loadRoute())(makeRequest())
    const text = await response.text()

    assertNoMarkers(text, 'invariant-violation response body')
    assertNoMarkers(loggedText(), 'logs on the invariant-violation path')
    expect(response.status).toBe(500)
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'diff_invariant_violated',
        message: 'diff_invariant_violated'
      }
    })
  })

  it('leaks nothing when the landed-side query fails with the payload in its message', async () => {
    landedResult = {
      data: null,
      error: { message: `pg error ${PAYLOAD_MARKER}` }
    }

    const response = await (await loadRoute())(makeRequest())
    const text = await response.text()

    assertNoMarkers(text, 'landed-query-failure response body')
    assertNoMarkers(loggedText(), 'logs on the landed-query-failure path')
    expect(response.status).toBe(500)
    expect(JSON.parse(text)).toEqual({
      error: { code: 'landed_query_failed', message: 'landed_query_failed' }
    })
  })
})
