import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Retention is keyed on categories but writers use activity names; a gap yields a NULL
 * retention_until the sweep skips forever, so the first test greps app/ for `dataType:`.
 */

const APP_DIR = join(process.cwd(), 'app')
const USER_ID = '11111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/u.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Every `dataType: '<literal>'` written anywhere under app/. */
function writtenDataTypes(): string[] {
  const found = new Set<string>()
  for (const file of sourceFiles(APP_DIR)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/dataType:\s*'([a-z0-9_]+)'/giu)) {
      found.add(match[1])
    }
  }
  return [...found].sort()
}

type InsertedRow = Record<string, unknown>

function harness() {
  const inserted: InsertedRow[] = []
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'gdpr_processing_log') {
        return {
          insert: vi.fn(async (row: InsertedRow) => {
            inserted.push(row)
            return { error: null }
          })
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
  }
  return { client, inserted }
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

afterEach(() => {
  vi.resetModules()
})

describe('GDPR retention map covers every written data type', () => {
  it('maps every `dataType:` literal in app/ to a defined retention period', async () => {
    const { GDPR_RETENTION_KEY_BY_DATA_TYPE, GDPR_CONFIG } =
      await import('@/app/lib/compliance/gdpr-manager')

    const written = writtenDataTypes()
    expect(written).toEqual(
      expect.arrayContaining([
        'account_deletion_immediate',
        'complete_export',
        'deletion_completed',
        'deletion_request',
        'loki_credential_erasure'
      ])
    )

    const unmapped = written.filter(
      (dataType) => GDPR_RETENTION_KEY_BY_DATA_TYPE[dataType] === undefined
    )
    expect(unmapped).toEqual([])

    // A key mapping to a null/absent period would stamp NULL again.
    for (const dataType of written) {
      const key = GDPR_RETENTION_KEY_BY_DATA_TYPE[dataType]
      expect(typeof GDPR_CONFIG.retention[key]).toBe('number')
    }
  })

  it('agrees with what the export bundle tells the subject: 7 years', async () => {
    const { GDPR_CONFIG, GDPR_RETENTION_KEY_BY_DATA_TYPE } =
      await import('@/app/lib/compliance/gdpr-manager')
    // The export prints "Processing logs: 7 years"; only auditLogs agrees.
    for (const key of Object.values(GDPR_RETENTION_KEY_BY_DATA_TYPE)) {
      expect(key).toBe('auditLogs')
    }
    expect(GDPR_CONFIG.retention.auditLogs).toBe(2555)
  })
})

describe('recordDataProcessing stamps retention_until', () => {
  it.each([
    'account_deletion_immediate',
    'complete_export',
    'deletion_completed',
    'deletion_request',
    'loki_credential_erasure'
  ])('writes timestamp + 2555 days for %s', async (dataType) => {
    const h = harness()
    await mockModules(h.client)
    const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')

    await gdprManager.recordDataProcessing({
      userId: USER_ID,
      dataType,
      processingPurpose: 'gdpr_test',
      legalBasis: 'legal_obligation'
    })

    expect(h.inserted).toHaveLength(1)
    const row = h.inserted[0]
    expect(row.retention_until).not.toBeNull()

    const stamped = Date.parse(row.retention_until as string)
    const written = Date.parse(row.timestamp as string)
    const days = (stamped - written) / (24 * 60 * 60 * 1000)
    // Calendar arithmetic (setDate) over 7 years crosses DST, so allow an hour.
    expect(days).toBeGreaterThan(2555 - 0.05)
    expect(days).toBeLessThan(2555 + 0.05)
  })

  it('an UNMAPPED data type still writes the audit row, loudly, with a null stamp', async () => {
    const h = harness()
    await mockModules(h.client)
    const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')

    await gdprManager.recordDataProcessing({
      userId: USER_ID,
      dataType: 'not_a_real_activity',
      processingPurpose: 'gdpr_test',
      legalBasis: 'legal_obligation'
    })

    expect(h.inserted).toHaveLength(1)
    expect(h.inserted[0].retention_until).toBeNull()
    // A lookup gap must not block the Art. 30 insert, but is logged as an alertable error.
    const event = mocks.logger.error.mock.calls.find(
      (args) =>
        (args[0] as Record<string, unknown> | undefined)?.event ===
        'gdpr.retention.unmapped_data_type'
    )
    expect(event).toBeDefined()
  })
})
