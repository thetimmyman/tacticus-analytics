import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Export retries once then alerts; `data.profile` never comes from to_jsonb(auth.users.*). */

const USER_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const OBJECT_NAME = `${USER_ID}/gdpr-export-${REQUEST_ID}.json`

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

function authProfileFixture() {
  return {
    id: USER_ID,
    email: 'subject@example.test',
    created_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-06-01T00:00:00.000Z',
    encrypted_password: '$2a$10$notarealhashbutshapedlikeone',
    confirmation_token: 'confirm-token',
    recovery_token: 'recovery-token',
    email_change_token_new: 'change-new',
    email_change_token_current: 'change-current',
    phone_change_token: 'phone-change',
    reauthentication_token: 'reauth-token',
    raw_app_meta_data: { provider: 'email' },
    raw_user_meta_data: { nickname: 'subject' },
    banned_until: null
  }
}

function exportBundleFixture() {
  return {
    export_generated_at: '2026-09-08T00:00:00.000Z',
    user_id: USER_ID,
    data: {
      profile: authProfileFixture(),
      player_mappings: [{ user_id: USER_ID, display_name: 'Subject' }],
      battle_data: [{ damageDealt: 1 }],
      processing_history: [{ data_type: 'deletion_request' }],
      token_alert_preferences: { user_id: USER_ID },
      token_alert_state: {}
    },
    data_summary: {
      total_battles: 1,
      total_players: 1,
      data_retention_info: 'Battle data: indefinite, Processing logs: 7 years'
    }
  }
}

type Upload = { name: string; body: string }

// `halfSuccess` writes then fails at signing, so a naive retry fails forever against `upsert: false`.
function createHarness(
  options: { failUploads?: number; halfSuccess?: boolean } = {}
) {
  const failUploads = options.failUploads ?? 0
  const halfSuccess = options.halfSuccess ?? false
  const statusUpdates: Record<string, unknown>[] = []
  const objects = new Map<string, string>()
  const uploads: Upload[] = []
  const removals: string[][] = []
  let uploadAttempts = 0
  let rpcCalls = 0

  const storageBucket = {
    upload: vi.fn(
      async (
        name: string,
        body: Buffer,
        _opts: { contentType: string; upsert: boolean }
      ) => {
        uploadAttempts += 1
        uploads.push({ name, body: body.toString('utf8') })
        if (uploadAttempts <= failUploads) {
          return { data: null, error: { message: 'storage unavailable' } }
        }
        if (objects.has(name)) {
          return { data: null, error: { message: 'Duplicate', status: 409 } }
        }
        objects.set(name, body.toString('utf8'))
        return { data: { path: name }, error: null }
      }
    ),
    createSignedUrl: vi.fn(async (name: string) => {
      if (halfSuccess && uploadAttempts === 1) {
        return { data: null, error: { message: 'signing unavailable' } }
      }
      return {
        data: { signedUrl: `https://storage.test/${name}?token=x` },
        error: null
      }
    }),
    remove: vi.fn(async (names: string[]) => {
      removals.push(names)
      for (const name of names) objects.delete(name)
      return { data: null, error: null }
    })
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'gdpr_data_exports') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn(async () => {
              statusUpdates.push(payload)
              return { error: null }
            })
          }))
        }
      }
      if (table === 'gdpr_processing_log') {
        return { insert: vi.fn(async () => ({ error: null })) }
      }
      throw new Error(`unexpected table ${table}`)
    }),
    rpc: vi.fn(async () => {
      rpcCalls += 1
      return { data: exportBundleFixture(), error: null }
    }),
    storage: { from: vi.fn(() => storageBucket) }
  }

  return {
    client,
    storageBucket,
    statusUpdates,
    objects,
    uploads,
    removals,
    uploadAttempts: () => uploadAttempts,
    rpcCalls: () => rpcCalls
  }
}

async function mockModules(client: unknown) {
  vi.doMock('@/app/lib/db', () => ({
    db: vi.fn(),
    serviceDb: vi.fn().mockReturnValue(client)
  }))
  vi.doMock('@/app/lib/logging', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/lib/logging')>()),
    createComponentLogger: () => mocks.logger
  }))
}

// processDataExport is fire-and-forget; calling it directly keeps retries deterministic.
type ExportInternals = {
  processDataExport(requestId: string, userId: string): Promise<void>
}

async function runExport(client: unknown): Promise<void> {
  const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
  await (gdprManager as unknown as ExportInternals).processDataExport(
    REQUEST_ID,
    USER_ID
  )
}

function loggedEvent(
  spy: typeof mocks.logger.error,
  event: string
): Record<string, unknown> | undefined {
  const call = spy.mock.calls.find(
    (args) => (args[0] as Record<string, unknown> | undefined)?.event === event
  )
  return call?.[0] as Record<string, unknown> | undefined
}

const statuses = (updates: Record<string, unknown>[]) =>
  updates.map((u) => u.status)

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

afterEach(() => {
  vi.resetModules()
})

describe('Article 15 export retries once then fails terminally', () => {
  it('first attempt fails, second succeeds: completed, one object, no alert', async () => {
    const h = createHarness({ failUploads: 1 })
    await mockModules(h.client)

    await runExport(h.client)

    expect(h.uploadAttempts()).toBe(2)
    expect(statuses(h.statusUpdates)).toEqual(['processing', 'completed'])
    expect(h.objects.size).toBe(1)
    expect([...h.objects.keys()]).toEqual([OBJECT_NAME])

    const completed = h.statusUpdates.at(-1)
    expect(completed?.download_url).toContain('https://storage.test/')
    expect(completed?.expires_at).toBeTruthy()

    expect(loggedEvent(mocks.logger.warn, 'gdpr.export.retry')).toMatchObject({
      requestId: REQUEST_ID
    })
    expect(
      loggedEvent(mocks.logger.error, 'gdpr.export.failed')
    ).toBeUndefined()
  })

  it('a half-successful first attempt is cleaned up, not duplicated', async () => {
    // Object written, signing failed: without removal the retry can only return "Duplicate".
    const h = createHarness({ halfSuccess: true })
    await mockModules(h.client)

    await runExport(h.client)

    expect(h.removals).toEqual([[OBJECT_NAME]])
    expect(statuses(h.statusUpdates)).toEqual(['processing', 'completed'])
    expect(h.objects.size).toBe(1)
  })

  it('both attempts fail: status failed exactly once, alert emitted, no third attempt', async () => {
    const h = createHarness({ failUploads: 99 })
    await mockModules(h.client)

    await runExport(h.client)

    expect(h.uploadAttempts()).toBe(2)
    expect(h.rpcCalls()).toBe(2)
    expect(statuses(h.statusUpdates)).toEqual(['processing', 'failed'])
    expect(h.statusUpdates.filter((u) => u.status === 'failed')).toHaveLength(1)
    expect(h.objects.size).toBe(0)

    // cron.job_run_details reports `succeeded` regardless, so failure needs an alertable event.
    const alert = loggedEvent(mocks.logger.error, 'gdpr.export.failed')
    expect(alert).toBeDefined()
    expect(alert?.requestId).toBe(REQUEST_ID)
    expect(alert?.userId).toBe(USER_ID)
    expect(alert?.failure).toBeDefined()
  })
})

describe('Article 15 export payload is a reviewed projection', () => {
  const CREDENTIAL_FIELDS = [
    'encrypted_password',
    'confirmation_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token',
    'reauthentication_token',
    'raw_app_meta_data'
  ]

  it('uploads no auth credential or token fields', async () => {
    const h = createHarness()
    await mockModules(h.client)

    await runExport(h.client)

    expect(h.uploads).toHaveLength(1)
    const uploaded = JSON.parse(h.uploads[0].body) as {
      data: { profile: Record<string, unknown> }
    }

    for (const field of CREDENTIAL_FIELDS) {
      expect(uploaded.data.profile).not.toHaveProperty(field)
    }
    for (const secret of [
      '$2a$10$notarealhashbutshapedlikeone',
      'confirm-token',
      'recovery-token',
      'change-new',
      'change-current',
      'phone-change',
      'reauth-token'
    ]) {
      expect(h.uploads[0].body).not.toContain(secret)
    }
  })

  it('keeps the reviewed profile fields and every app-level branch', async () => {
    const h = createHarness()
    await mockModules(h.client)

    await runExport(h.client)

    const uploaded = JSON.parse(h.uploads[0].body) as Record<string, unknown>
    const data = uploaded.data as Record<string, unknown>

    expect(data.profile).toEqual({
      id: USER_ID,
      email: 'subject@example.test',
      created_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-06-01T00:00:00.000Z'
    })

    const fixture = exportBundleFixture()
    expect(data.player_mappings).toEqual(fixture.data.player_mappings)
    expect(data.battle_data).toEqual(fixture.data.battle_data)
    expect(data.processing_history).toEqual(fixture.data.processing_history)
    expect(data.token_alert_preferences).toEqual(
      fixture.data.token_alert_preferences
    )
    expect(data.token_alert_state).toEqual(fixture.data.token_alert_state)
    expect(uploaded.data_summary).toEqual(fixture.data_summary)
    expect(uploaded.user_id).toBe(USER_ID)
  })

  it('projectExportBundle is an allow-list, so an unknown auth column is dropped', async () => {
    const { projectExportBundle } =
      await import('@/app/lib/compliance/gdpr-manager')
    const projected = projectExportBundle({
      data: { profile: { id: USER_ID, some_future_secret: 'oops' } }
    }) as { data: { profile: Record<string, unknown> } }

    expect(projected.data.profile).toEqual({ id: USER_ID })
  })
})
