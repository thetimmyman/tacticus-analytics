import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Nothing polls `pending` exports, so re-drive reuses `processDataExport` and its contract. */

const USER_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const ADMIN_ID = '22222222-2222-4222-8222-222222222222'
const UNKNOWN_ID = '44444444-4444-4444-8444-444444444444'
const OBJECT_NAME = `${USER_ID}/gdpr-export-${REQUEST_ID}.json`

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

/** The auth row the RPC serialises verbatim, credentials included. */
function exportBundleFixture() {
  return {
    export_generated_at: '2026-09-08T00:00:00.000Z',
    user_id: USER_ID,
    data: {
      profile: {
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
        reauthentication_token: 'reauth-token'
      },
      player_mappings: [{ user_id: USER_ID, display_name: 'Subject' }],
      battle_data: [{ damageDealt: 1 }]
    },
    data_summary: { total_battles: 1 }
  }
}

type ExportRow = {
  request_id: string
  user_id: string
  status: string
  requested_at: string | null
  created_at: string
  processing_started_at: string | null
  completed_at: string | null
  download_url: string | null
  expires_at: string | null
}

type Upload = { name: string; body: string }

// claim_gdpr_export_redrive's p_stuck_export_minutes default, which gdpr-manager.ts relies on.
const STUCK_EXPORT_MINUTES = 60

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function createHarness(
  options: {
    status?: string
    missing?: boolean
    staleObject?: boolean
    failUploads?: number
    requestedAt?: string | null
    createdAt?: string
    processingStartedAt?: string
    claimError?: { message: string }
  } = {}
) {
  const failUploads = options.failUploads ?? 0
  const row: ExportRow | null = options.missing
    ? null
    : {
        request_id: REQUEST_ID,
        user_id: USER_ID,
        status: options.status ?? 'failed',
        requested_at:
          options.requestedAt === undefined
            ? minutesAgo(5)
            : options.requestedAt,
        created_at: options.createdAt ?? minutesAgo(5),
        processing_started_at: options.processingStartedAt ?? null,
        completed_at: '2026-06-23T00:00:00.000Z',
        download_url: null,
        expires_at: null
      }

  const statusUpdates: Record<string, unknown>[] = []
  const auditRows: Record<string, unknown>[] = []
  const objects = new Map<string, string>()
  const uploads: Upload[] = []
  const removals: string[][] = []
  let uploadAttempts = 0

  if (options.staleObject) objects.set(OBJECT_NAME, '{"stale":true}')

  const storageBucket = {
    upload: vi.fn(async (name: string, body: Buffer) => {
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
    }),
    createSignedUrl: vi.fn(async (name: string) => ({
      data: { signedUrl: `https://storage.test/${name}?token=x` },
      error: null
    })),
    remove: vi.fn(async (names: string[]) => {
      removals.push(names)
      for (const name of names) objects.delete(name)
      return { data: null, error: null }
    })
  }

  // Mirrors the migration's single UPDATE: decide and stamp in one synchronous step.
  const claims: boolean[] = []
  const claimRow = (): boolean => {
    let claimed = false
    if (row) {
      const openedAt =
        row.processing_started_at ?? row.requested_at ?? row.created_at
      const stuck =
        (row.status === 'pending' || row.status === 'processing') &&
        Date.parse(openedAt) < Date.now() - STUCK_EXPORT_MINUTES * 60 * 1000
      if (row.status === 'failed' || stuck) {
        row.status = 'processing'
        row.processing_started_at = new Date().toISOString()
        claimed = true
      }
    }
    claims.push(claimed)
    return claimed
  }

  const exportsTable = () => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: row ? { ...row } : null,
          error: null
        }))
      }))
    })),
    update: vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(async () => {
        statusUpdates.push(payload)
        if (row) Object.assign(row, payload)
        return { error: null }
      })
    }))
  })

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'gdpr_data_exports') return exportsTable()
      if (table === 'gdpr_processing_log') {
        return {
          insert: vi.fn(async (auditRow: Record<string, unknown>) => {
            auditRows.push(auditRow)
            return { error: null }
          })
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
    rpc: vi.fn(async (name: string) => {
      if (name === 'claim_gdpr_export_redrive') {
        if (options.claimError) return { data: null, error: options.claimError }
        return { data: claimRow(), error: null }
      }
      return { data: exportBundleFixture(), error: null }
    }),
    storage: { from: vi.fn(() => storageBucket) }
  }

  return {
    client,
    row,
    statusUpdates,
    auditRows,
    objects,
    uploads,
    removals,
    storageBucket,
    claims,
    uploadAttempts: () => uploadAttempts
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

async function redrive(requestId = REQUEST_ID, invoker = ADMIN_ID) {
  const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
  return gdprManager.redriveDataExport(requestId, invoker)
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

describe('redriveDataExport re-runs a failed export', () => {
  it('re-drives a failed row to completed and reports the verdict', async () => {
    const h = createHarness({ status: 'failed' })
    await mockModules(h.client)

    const result = await redrive()

    expect(result).toEqual({ outcome: 'redriven', status: 'completed' })
    expect(statuses(h.statusUpdates)).toEqual(['processing', 'completed'])
    expect(h.objects.size).toBe(1)
    expect([...h.objects.keys()]).toEqual([OBJECT_NAME])
    const completed = h.statusUpdates.at(-1)
    expect(completed?.download_url).toContain('https://storage.test/')
    expect(completed?.expires_at).toBeTruthy()
  })

  it('stamps processing_started_at when an attempt starts, so a long-queued run is not read as stuck', async () => {
    const h = createHarness({ status: 'failed' })
    await mockModules(h.client)
    const before = Date.now()

    await redrive()

    const started = h.statusUpdates.find((u) => u.status === 'processing')
    expect(started?.processing_started_at).toEqual(expect.any(String))
    expect(
      Date.parse(started?.processing_started_at as string)
    ).toBeGreaterThanOrEqual(before)
  })

  it('records an Article 30 row naming the invoking operator', async () => {
    const h = createHarness({ status: 'failed' })
    await mockModules(h.client)
    const { GDPR_EXPORT_REDRIVE_PURPOSE_PREFIX } =
      await import('@/app/lib/compliance/gdpr-manager')

    await redrive()

    const audit = h.auditRows.filter((r) => r.data_type === 'export_redrive')
    expect(audit).toHaveLength(1)
    // The subject owns the row (its RLS SELECT policy is keyed on it)...
    expect(audit[0].user_id).toBe(USER_ID)
    expect(audit[0].processing_purpose).toBe(
      `${GDPR_EXPORT_REDRIVE_PURPOSE_PREFIX}${ADMIN_ID}`
    )
    expect(audit[0].processing_purpose).toContain(ADMIN_ID)
    expect(audit[0].legal_basis).toBe('legal_obligation')
    // An unmapped data_type writes a NULL retention stamp the sweep never reaches.
    expect(audit[0].retention_until).not.toBeNull()
  })

  it('writes the audit row BEFORE the export, so a failed re-drive is still on the record', async () => {
    const h = createHarness({ status: 'failed', failUploads: 99 })
    await mockModules(h.client)

    const result = await redrive()

    expect(result).toEqual({ outcome: 'redriven', status: 'failed' })
    expect(
      h.auditRows.filter((r) => r.data_type === 'export_redrive')
    ).toHaveLength(1)
    expect(h.uploadAttempts()).toBe(2)
    expect(statuses(h.statusUpdates)).toEqual(['processing', 'failed'])
    const alert = mocks.logger.error.mock.calls.find(
      (args) =>
        (args[0] as Record<string, unknown> | undefined)?.event ===
        'gdpr.export.failed'
    )
    expect(alert).toBeDefined()
  })

  it('keeps the restricted projection: no auth credential reaches the re-driven file', async () => {
    const h = createHarness({ status: 'failed' })
    await mockModules(h.client)

    await redrive()

    expect(h.uploads).toHaveLength(1)
    const uploaded = JSON.parse(h.uploads[0].body) as {
      data: { profile: Record<string, unknown> }
    }
    expect(uploaded.data.profile).toEqual({
      id: USER_ID,
      email: 'subject@example.test',
      created_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-06-01T00:00:00.000Z'
    })
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

  it('clears the stale object from the failed run before its FIRST upload', async () => {
    // Without delete-first, a stale object burns the only retry on "Duplicate".
    const h = createHarness({ status: 'failed', staleObject: true })
    await mockModules(h.client)

    const result = await redrive()

    expect(h.removals[0]).toEqual([OBJECT_NAME])
    expect(h.uploadAttempts()).toBe(1)
    expect(result).toEqual({ outcome: 'redriven', status: 'completed' })
    expect(h.objects.size).toBe(1)
    expect(h.objects.get(OBJECT_NAME)).not.toContain('stale')
    for (const call of h.storageBucket.upload.mock.calls) {
      expect((call[2] as { upsert: boolean }).upsert).toBe(false)
    }
  })

  it('an unknown request id is not found, and runs no export', async () => {
    const h = createHarness({ missing: true })
    await mockModules(h.client)

    const result = await redrive(UNKNOWN_ID)

    expect(result).toEqual({ outcome: 'not_found' })
    expect(h.statusUpdates).toEqual([])
    expect(h.auditRows).toEqual([])
    expect(h.uploads).toEqual([])
  })

  it.each(['pending', 'processing'])(
    'refuses a fresh %s row (still within a live attempt): no transition, no audit row, no export',
    async (status) => {
      const h = createHarness({ status, requestedAt: minutesAgo(5) })
      await mockModules(h.client)

      const result = await redrive()

      expect(result).toEqual({ outcome: 'not_redrivable', status })
      expect(h.statusUpdates).toEqual([])
      expect(h.auditRows).toEqual([])
      expect(h.uploads).toEqual([])
      expect(h.row?.status).toBe(status)
    }
  )

  it('refuses a completed row regardless of age: it holds a signed URL the subject can still use', async () => {
    const h = createHarness({
      status: 'completed',
      requestedAt: minutesAgo(STUCK_EXPORT_MINUTES + 1)
    })
    await mockModules(h.client)

    const result = await redrive()

    expect(result).toEqual({ outcome: 'not_redrivable', status: 'completed' })
    expect(h.statusUpdates).toEqual([])
    expect(h.auditRows).toEqual([])
    expect(h.uploads).toEqual([])
  })

  it.each(['pending', 'processing'])(
    'gives a stuck %s row a re-drive path: one minute past the stuck threshold runs the export',
    async (status) => {
      const h = createHarness({
        status,
        requestedAt: minutesAgo(STUCK_EXPORT_MINUTES + 1)
      })
      await mockModules(h.client)

      const result = await redrive()

      expect(result).toEqual({ outcome: 'redriven', status: 'completed' })
      expect(statuses(h.statusUpdates)).toEqual(['processing', 'completed'])
      expect(
        h.auditRows.filter((r) => r.data_type === 'export_redrive')
      ).toHaveLength(1)
    }
  )

  it.each(['pending', 'processing'])(
    'pins the stuck threshold on a %s row: five seconds under it is not yet stuck',
    async (status) => {
      // A few seconds under the threshold, not exactly at it: exact-boundary timing
      // is at the mercy of how long the test itself takes to reach the check.
      const h = createHarness({
        status,
        requestedAt: new Date(
          Date.now() - (STUCK_EXPORT_MINUTES * 60 * 1000 - 5000)
        ).toISOString()
      })
      await mockModules(h.client)

      const result = await redrive()

      expect(result).toEqual({ outcome: 'not_redrivable', status })
      expect(h.statusUpdates).toEqual([])
    }
  )

  it('falls back to created_at like the monitor: a stuck row with no requested_at is re-drivable', async () => {
    const h = createHarness({
      status: 'processing',
      requestedAt: null,
      createdAt: minutesAgo(STUCK_EXPORT_MINUTES + 1)
    })
    await mockModules(h.client)

    const result = await redrive()

    expect(result).toEqual({ outcome: 'redriven', status: 'completed' })
    expect(h.claims).toEqual([true])
  })

  it('refuses a second re-drive while the first is still running, even on an old request', async () => {
    const h = createHarness({
      status: 'failed',
      requestedAt: minutesAgo(STUCK_EXPORT_MINUTES * 24)
    })
    await mockModules(h.client)

    const [first, second] = await Promise.all([redrive(), redrive()])

    expect([first.outcome, second.outcome].sort()).toEqual([
      'not_redrivable',
      'redriven'
    ])
    expect(h.claims).toEqual([true, false])
    expect(
      h.auditRows.filter((r) => r.data_type === 'export_redrive')
    ).toHaveLength(1)
    expect(h.uploads).toHaveLength(1)
  })

  it('refuses a re-drive of a processing row a recent re-drive claimed, however old its request', async () => {
    const h = createHarness({
      status: 'processing',
      requestedAt: minutesAgo(STUCK_EXPORT_MINUTES * 24),
      processingStartedAt: minutesAgo(5)
    })
    await mockModules(h.client)

    const result = await redrive()

    expect(result).toEqual({ outcome: 'not_redrivable', status: 'processing' })
    expect(h.statusUpdates).toEqual([])
    expect(h.auditRows).toEqual([])
    expect(h.uploads).toEqual([])
  })

  it('propagates a claim RPC error without running the export', async () => {
    const h = createHarness({
      status: 'failed',
      claimError: { message: 'claim unavailable' }
    })
    await mockModules(h.client)

    await expect(redrive()).rejects.toEqual({ message: 'claim unavailable' })
    expect(h.auditRows).toEqual([])
    expect(h.uploads).toEqual([])
  })
})

/** Hosted exports remain request/re-drive driven; the desktop worker is separately gated. */
const APP_DIR = join(process.cwd(), 'app')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/u.test(entry)) out.push(full)
  }
  return out
}

describe('NEGATIVE CONTROL: hosted exports have no automatic pending-row poller', () => {
  it('has no pending-row reader outside the explicit desktop worker', async () => {
    const offenders: string[] = []
    for (const file of sourceFiles(APP_DIR)) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('gdpr_data_exports')) continue
      // Its hosted refusal is tested by export-local-profile-data.test.ts; the
      // native journey also exercises the actual durable worker and SQL scope.
      if (file === join(APP_DIR, 'lib', 'jobs', 'export-local-profile-data.ts'))
        continue
      // Reads for display only; any other status-keyed read would be a poller.
      for (const match of text.matchAll(
        /\.(?:eq|in)\(\s*'status'\s*,\s*(?:'pending'|\[[^\]]*'pending'[^\]]*\])/gu
      )) {
        if (file.endsWith('gdpr-manager.ts') && match[0].includes('[')) continue
        offenders.push(`${file}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the ONLY callers of processDataExport are the request flow and the re-drive', async () => {
    const text = readFileSync(
      join(APP_DIR, 'lib', 'compliance', 'gdpr-manager.ts'),
      'utf8'
    )
    const code = text
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
      .join('\n')
    const callSites = [...code.matchAll(/this\.processDataExport\(/gu)]
    expect(callSites).toHaveLength(2)
    expect(code).toContain('void this.processDataExport(requestId, userId)')
    // ...and one awaited re-entry from the re-drive, which does not reimplement it.
    expect(code).toContain(
      'await this.processDataExport(requestId, row.user_id, { firstAttempt: 1 })'
    )
  })
})
