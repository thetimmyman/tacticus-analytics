/**
 * Pins ordering and recovery: the Article 17 request row is filed before anything is destroyed,
 * and a failed auth delete leaves a `scheduled` row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const SUBJECT_NAME = 'Fixture'
const CONTROL_NAME = 'Control'
// Erasure keys on the real player id, not the shareable `displayName`.
const SUBJECT_PLAYER_ID = 'player-subject'
const OTHER_PLAYER_ID = 'player-other'
const NAMESAKE_PLAYER_ID = 'player-namesake'

type Row = Record<string, unknown>

type FkMode = 'no_action' | 'set_null'

interface FakeDb {
  tables: Map<string, Row[]>
  authUsers: Set<string>
  fkMode: FkMode
  refs: Array<{ table: string; column: string }>
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  deleteUserCalls: string[]
  failTable: string | null
}

function makeDb(fkMode: FkMode): FakeDb {
  return {
    tables: new Map<string, Row[]>([
      ['gdpr_deletion_requests', []],
      ['gdpr_processing_log', []],
      [
        'player_mapping',
        [
          {
            id: 1,
            user_id: USER,
            display_name: SUBJECT_NAME,
            player_id: SUBJECT_PLAYER_ID
          },
          {
            id: 2,
            user_id: OTHER_USER,
            display_name: CONTROL_NAME,
            player_id: OTHER_PLAYER_ID
          }
        ]
      ],
      // Models player_invite_codes: the row holding the NO ACTION reference.
      ['invite_codes', [{ id: 1, code: 'ABC', created_by: USER }]],
      [
        'webhook_config',
        [
          { id: 1, updated_by: USER },
          { id: 2, updated_by: OTHER_USER }
        ]
      ],
      [
        'guild_themes',
        [
          { id: 1, updated_by: USER },
          { id: 2, updated_by: OTHER_USER }
        ]
      ],
      [
        'EOT_GR_data',
        [
          { id: 1, displayName: SUBJECT_NAME, userId: SUBJECT_PLAYER_ID },
          { id: 2, displayName: SUBJECT_NAME, userId: SUBJECT_PLAYER_ID },
          { id: 3, displayName: CONTROL_NAME, userId: OTHER_PLAYER_ID }
        ]
      ]
    ]),
    authUsers: new Set([USER, OTHER_USER]),
    fkMode,
    refs: [{ table: 'invite_codes', column: 'created_by' }],
    rpcCalls: [],
    deleteUserCalls: [],
    failTable: null
  }
}

const rows = (db: FakeDb, table: string): Row[] => {
  if (!db.tables.has(table)) db.tables.set(table, [])
  return db.tables.get(table) as Row[]
}

/** Models subject_erasure_player_ids(): bound plus attested players, minus revoked and rebound ones. */
function subjectErasureIds(db: FakeDb, userId: string): Set<string> {
  const disputed = new Set([
    'admin_unlink',
    'support_reverify',
    'authority_recovery',
    'mapping_delete'
  ])
  const ids = new Set<string>()
  for (const r of rows(db, 'player_mapping')) {
    if (r.user_id === userId) ids.add(String(r.player_id))
  }
  for (const a of rows(db, 'player_identity_attestations')) {
    if (a.subject_user_id !== userId) continue
    if (disputed.has(String(a.revoked_reason))) continue
    const ownedByOther = rows(db, 'player_mapping').some(
      (m) =>
        m.player_id === a.player_id && m.user_id != null && m.user_id !== userId
    )
    if (!ownedByOther) ids.add(String(a.player_id))
  }
  return ids
}

function buildClient(db: FakeDb) {
  const from = (table: string) => {
    const makeSelect = (filters: Array<(r: Row) => boolean>) => {
      const result = () => ({
        data: rows(db, table).filter((r) => filters.every((f) => f(r))),
        error: null
      })
      const chain: Record<string, unknown> = {
        eq: (col: string, val: unknown) =>
          makeSelect([...filters, (r) => r[col] === val]),
        lte: (col: string, val: string) =>
          makeSelect([...filters, (r) => String(r[col]) <= val]),
        returns: async () => result(),
        single: async () => {
          const found = result().data
          return found.length === 1
            ? { data: found[0], error: null }
            : { data: null, error: { message: 'not a single row' } }
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result())
      }
      return chain
    }

    const makeWrite = (apply: (matching: Row[]) => void) => {
      const run = (filters: Array<(r: Row) => boolean>) => {
        if (db.failTable === table) {
          return { data: null, error: { message: `${table} write rejected` } }
        }
        apply(rows(db, table).filter((r) => filters.every((f) => f(r))))
        return { data: null, error: null }
      }
      const chain = (
        filters: Array<(r: Row) => boolean>
      ): Record<string, unknown> => ({
        eq: (col: string, val: unknown) =>
          chain([...filters, (r) => r[col] === val]),
        or: () => chain(filters),
        in: (col: string, vals: unknown[]) =>
          chain([...filters, (r) => vals.includes(r[col])]),
        select: async () => run(filters),
        then: (resolve: (v: unknown) => unknown) => resolve(run(filters))
      })
      return chain([])
    }

    return {
      select: () => makeSelect([]),
      insert: (row: Row | Row[]) => {
        const list = Array.isArray(row) ? row : [row]
        rows(db, table).push(...list)
        const inserted = list
        return {
          select: () => ({
            single: async () => ({ data: inserted[0], error: null })
          }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: inserted, error: null })
        }
      },
      update: (patch: Row) =>
        makeWrite((matching) => {
          for (const r of matching) Object.assign(r, patch)
        }),
      delete: () =>
        makeWrite((matching) => {
          const all = rows(db, table)
          for (const r of matching) all.splice(all.indexOf(r), 1)
        })
    }
  }

  return {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ name, args })
      if (name === 'anonymize_subject_battle_rows') {
        // Locking is covered by pgTAP.
        if (db.failTable === 'EOT_GR_data') {
          return {
            data: null,
            error: { message: 'EOT_GR_data write rejected' }
          }
        }
        const ids = subjectErasureIds(db, args.p_user_id as string)
        const tombstone = `[DELETED_USER_${Date.now()}]`
        let anonymized = 0
        for (const r of rows(db, 'EOT_GR_data')) {
          if (ids.has(String(r.userId))) {
            r.displayName = tombstone
            anonymized += 1
          }
        }
        return { data: anonymized, error: null }
      }
      if (name !== 'prepare_player_account_deletion') {
        return { data: null, error: { message: `unmodelled rpc ${name}` } }
      }
      const userId = args.p_user_id as string
      let cleared = 0
      for (const r of rows(db, 'player_mapping')) {
        if (r.user_id === userId) {
          r.user_id = null
          cleared += 1
        }
      }
      return {
        data: {
          success: true,
          cleared_mapping_count: cleared,
          deleted_mapping_count: 0,
          subject_authority_blocked: true,
          revoked_attestations: 1,
          purged_loki_credential_count: 1,
          purged_loki_guild_codes: ['FIX'],
          binding_restorable: false
        },
        error: null
      }
    },
    auth: {
      getUser: async () => ({ data: { user: { id: USER } }, error: null }),
      admin: {
        getUserById: async (userId: string) =>
          db.authUsers.has(userId)
            ? { data: { user: { id: userId } }, error: null }
            : {
                data: { user: null },
                error: { code: 'user_not_found', status: 404 }
              },
        deleteUser: async (userId: string) => {
          db.deleteUserCalls.push(userId)
          if (!db.authUsers.has(userId)) {
            return { data: null, error: { code: 'user_not_found' } }
          }
          const blocking = db.refs.filter(({ table, column }) =>
            rows(db, table).some((r) => r[column] === userId)
          )
          if (blocking.length > 0) {
            if (db.fkMode === 'no_action') {
              return {
                data: null,
                error: {
                  code: '23503',
                  message: `update or delete on table "users" violates foreign key constraint on table "${blocking[0].table}"`
                }
              }
            }
            for (const { table, column } of blocking) {
              for (const r of rows(db, table)) {
                if (r[column] === userId) r[column] = null
              }
            }
          }
          db.authUsers.delete(userId)
          return { data: null, error: null }
        }
      }
    }
  }
}

async function loadRoute(db: FakeDb) {
  vi.resetModules()
  const client = buildClient(db)
  vi.doMock('@/app/lib/db', () => ({
    db: async () => client,
    serviceDb: () => client
  }))
  vi.doMock('@/app/lib/middleware/rate-limit', () => ({
    apiSecurityMiddleware: async () => null
  }))
  // The shared error handler needs the real helpers.
  vi.doMock('@/app/lib/logging', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/lib/logging')>()),
    createComponentLogger: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    })
  }))
  const [route, gdpr] = await Promise.all([
    import('@/app/api/account/delete/route'),
    import('@/app/lib/compliance/gdpr-manager')
  ])
  return { POST: route.POST, gdprManager: gdpr.gdprManager }
}

const request = () =>
  new NextRequest('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER, confirmationPhrase: 'DELETE' })
  })

const deletionRequests = (db: FakeDb) => rows(db, 'gdpr_deletion_requests')

describe('PS-39 self-serve account deletion reaches gdpr_erasure', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  })

  it('deletes a fixture user end to end and files an Article 17 erasure request', async () => {
    const db = makeDb('set_null')
    const { POST, gdprManager } = await loadRoute(db)

    const response = await POST(request())
    expect(response.status).toBe(200)

    expect(db.authUsers.has(USER)).toBe(false)
    // The FK is nulled, not cascaded: the invite code survives for its holders.
    expect(rows(db, 'invite_codes')).toHaveLength(1)
    expect(rows(db, 'invite_codes')[0].created_by).toBeNull()
    expect(rows(db, 'player_mapping')[0].user_id).toBeNull()
    expect(db.rpcCalls.map((c) => c.name)).toContain(
      'prepare_player_account_deletion'
    )

    // Closed, or the nightly executor would get a row whose subject is gone.
    const requests = deletionRequests(db)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      user_id: USER,
      request_type: 'complete',
      status: 'completed',
      data_categories: ['all']
    })
    expect(Number.isFinite(Date.parse(String(requests[0].completed_at)))).toBe(
      true
    )

    await gdprManager.executeScheduledDeletions()
    expect(deletionRequests(db)[0].status).toBe('completed')
    expect(db.deleteUserCalls).toEqual([USER])

    expect(db.authUsers.has(OTHER_USER)).toBe(true)
  })

  it('files the erasure request BEFORE anything is destroyed, so a failed auth delete is recoverable', async () => {
    const db = makeDb('no_action')
    const { POST, gdprManager } = await loadRoute(db)

    const response = await POST(request())
    expect(response.status).toBe(500)

    expect(db.authUsers.has(USER)).toBe(true)
    expect(rows(db, 'player_mapping')[0].user_id).toBeNull()

    // A `scheduled` row lets the gdpr-cleanup cron finish the erasure.
    const requests = deletionRequests(db)
    expect(requests).toHaveLength(1)
    expect(requests[0].status).toBe('scheduled')
    expect(
      new Date(String(requests[0].scheduled_for)).getTime()
    ).toBeLessThanOrEqual(Date.now() + 1000)

    db.fkMode = 'set_null'
    await gdprManager.executeScheduledDeletions()

    expect(db.deleteUserCalls.length).toBeGreaterThanOrEqual(2)
    expect(db.authUsers.has(USER)).toBe(false)
    expect(rows(db, 'invite_codes')[0].created_by).toBeNull()
    expect(deletionRequests(db)[0].status).toBe('completed')
  })

  it('executeScheduledDeletions retries a scheduled row whose auth user still exists', async () => {
    const db = makeDb('set_null')
    const { gdprManager } = await loadRoute(db)

    await gdprManager.handleDataDeletionRequest(USER, 'complete', [], {
      scheduledFor: new Date(Date.now() - 60_000).toISOString()
    })
    expect(db.authUsers.has(USER)).toBe(true)
    expect(db.deleteUserCalls).toHaveLength(0)

    await gdprManager.executeScheduledDeletions()

    expect(db.deleteUserCalls).toEqual([USER])
    expect(db.authUsers.has(USER)).toBe(false)
    expect(deletionRequests(db)[0].status).toBe('completed')
  })

  it('destroys nothing when the erasure request cannot be filed', async () => {
    const db = makeDb('set_null')
    const { POST } = await loadRoute(db)

    const table = rows(db, 'gdpr_deletion_requests')
    Object.defineProperty(table, 'push', {
      value: () => {
        throw new Error('insert failed')
      }
    })

    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.deleteUserCalls).toHaveLength(0)
    expect(db.authUsers.has(USER)).toBe(true)
    expect(rows(db, 'player_mapping')[0].user_id).toBe(USER)
  })
})

/** The sweep derives from the shared `eraseAllUserData` so the record cannot overstate it. */

const SUBJECT_RESIDUE: Array<{
  table: string
  stillSubject: (r: Row) => boolean
}> = [
  { table: 'webhook_config', stillSubject: (r) => r.updated_by === USER },
  { table: 'guild_themes', stillSubject: (r) => r.updated_by === USER },
  { table: 'player_mapping', stillSubject: (r) => r.user_id === USER },
  { table: 'EOT_GR_data', stillSubject: (r) => r.displayName === SUBJECT_NAME }
]

const residue = (db: FakeDb): string[] =>
  SUBJECT_RESIDUE.flatMap(({ table, stillSubject }) => {
    const count = rows(db, table).filter(stillSubject).length
    return count > 0 ? [`${table}=${count}`] : []
  })

const controlCounts = (db: FakeDb): Record<string, number> => ({
  webhook_config: rows(db, 'webhook_config').filter(
    (r) => r.updated_by === OTHER_USER
  ).length,
  guild_themes: rows(db, 'guild_themes').filter(
    (r) => r.updated_by === OTHER_USER
  ).length,
  player_mapping: rows(db, 'player_mapping').filter(
    (r) => r.user_id === OTHER_USER
  ).length,
  EOT_GR_data: rows(db, 'EOT_GR_data').filter(
    (r) => r.displayName === CONTROL_NAME
  ).length
})

describe('PS-197 route and cron erase the same tables', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  })

  it('leaves ZERO subject rows in every table the shared erasure path touches, and closes the record over the categories it really erased', async () => {
    const db = makeDb('set_null')
    const { POST } = await loadRoute(db)

    // Positive control: all-zero is not an empty fixture.
    expect(residue(db).sort()).toEqual([
      'EOT_GR_data=2',
      'guild_themes=1',
      'player_mapping=1',
      'webhook_config=1'
    ])
    const controlBefore = controlCounts(db)

    const response = await POST(request())
    expect(response.status).toBe(200)

    expect(residue(db)).toEqual([])
    expect(db.authUsers.has(USER)).toBe(false)
    // Battle rows are anonymized, not deleted, so guild statistics survive.
    expect(rows(db, 'EOT_GR_data')).toHaveLength(3)
    expect(
      rows(db, 'EOT_GR_data').filter((r) =>
        String(r.displayName).startsWith('[DELETED_USER_')
      )
    ).toHaveLength(2)

    expect(controlCounts(db)).toEqual(controlBefore)
    expect(db.authUsers.has(OTHER_USER)).toBe(true)

    const requests = deletionRequests(db)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      user_id: USER,
      request_type: 'complete',
      status: 'completed',
      data_categories: ['all']
    })
  })

  it('runs the erasure through the SAME function the nightly executor uses', async () => {
    const db = makeDb('set_null')
    const { POST } = await loadRoute(db)
    await POST(request())

    expect(db.rpcCalls).toEqual([
      {
        name: 'anonymize_subject_battle_rows',
        args: { p_user_id: USER }
      },
      {
        name: 'prepare_player_account_deletion',
        args: { p_user_id: USER, p_reason: 'account_delete' }
      }
    ])
  })

  it('does NOT complete the record when a step in the middle of the erasure fails', async () => {
    // No transaction spans GoTrue and PostgREST, so any failure must throw before the completion write.
    const db = makeDb('set_null')
    db.failTable = 'EOT_GR_data'
    const { POST } = await loadRoute(db)

    const response = await POST(request())
    expect(response.status).toBe(500)

    const requests = deletionRequests(db)
    expect(requests).toHaveLength(1)
    expect(requests[0].status).not.toBe('completed')
    expect(requests[0].status).toBe('scheduled')
    expect(requests[0].completed_at ?? null).toBeNull()

    expect(db.deleteUserCalls).toHaveLength(0)
    expect(db.authUsers.has(USER)).toBe(true)
  })
})

/** Two players can share a display name. */
describe('PS-288 erasure is keyed on player id, not display name', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  })

  it("anonymizes only the subject's player id, leaving a namesake's battle rows under a different player id untouched", async () => {
    const db = makeDb('set_null')
    rows(db, 'EOT_GR_data').push({
      id: 4,
      displayName: SUBJECT_NAME,
      userId: NAMESAKE_PLAYER_ID
    })
    const { POST } = await loadRoute(db)

    const response = await POST(request())
    expect(response.status).toBe(200)

    const subjectRows = rows(db, 'EOT_GR_data').filter(
      (r) => r.userId === SUBJECT_PLAYER_ID
    )
    expect(subjectRows).toHaveLength(2)
    for (const r of subjectRows) {
      expect(String(r.displayName)).toMatch(/^\[DELETED_USER_/)
    }

    const controlRow = rows(db, 'EOT_GR_data').find(
      (r) => r.userId === OTHER_PLAYER_ID
    )
    expect(controlRow?.displayName).toBe(CONTROL_NAME)

    const namesakeRow = rows(db, 'EOT_GR_data').find(
      (r) => r.userId === NAMESAKE_PLAYER_ID
    )
    expect(namesakeRow?.displayName).toBe(SUBJECT_NAME)
  })

  describe('PS-670 departed members', () => {
    const DEPARTED_PLAYER_ID = 'player-departed'

    // deactivate_player_mappings() nulled user_id; only the attestation ledger links it.
    const withDepartedPlayer = (db: FakeDb, attested: boolean) => {
      rows(db, 'player_mapping').push({
        id: 3,
        user_id: null,
        display_name: 'Old Name',
        player_id: DEPARTED_PLAYER_ID
      })
      if (attested) {
        rows(db, 'player_identity_attestations').push({
          player_id: DEPARTED_PLAYER_ID,
          subject_user_id: USER,
          revoked_reason: 'roster_deactivation'
        })
      }
      rows(db, 'EOT_GR_data').push({
        id: 5,
        displayName: 'Old Name',
        userId: DEPARTED_PLAYER_ID
      })
    }
    const departedRow = (db: FakeDb) =>
      rows(db, 'EOT_GR_data').find((r) => r.userId === DEPARTED_PLAYER_ID)

    it("anonymizes a departed player's battle rows found only through attestation", async () => {
      const db = makeDb('set_null')
      withDepartedPlayer(db, true)
      const { POST } = await loadRoute(db)

      const response = await POST(request())
      expect(response.status).toBe(200)
      expect(String(departedRow(db)?.displayName)).toMatch(/^\[DELETED_USER_/)
      expect(
        rows(db, 'EOT_GR_data').find((r) => r.userId === OTHER_PLAYER_ID)
          ?.displayName
      ).toBe(CONTROL_NAME)
    })

    it("positive control: without the attestation the departed player is not the subject's to erase", async () => {
      const db = makeDb('set_null')
      withDepartedPlayer(db, false)
      const { POST } = await loadRoute(db)

      const response = await POST(request())
      expect(response.status).toBe(200)
      expect(departedRow(db)?.displayName).toBe('Old Name')
    })
  })

  it('skips the anonymization update entirely, without error, when the subject has no player_mapping rows', async () => {
    const db = makeDb('set_null')
    const mapping = rows(db, 'player_mapping')
    const idx = mapping.findIndex((r) => r.user_id === USER)
    mapping.splice(idx, 1)

    const { POST } = await loadRoute(db)
    const response = await POST(request())
    expect(response.status).toBe(200)

    expect(
      rows(db, 'EOT_GR_data').every(
        (r) => !String(r.displayName).startsWith('[DELETED_USER_')
      )
    ).toBe(true)
  })
})
