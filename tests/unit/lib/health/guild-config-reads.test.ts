import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Sync-state columns are not in anon's grant (42501); the column is `api_key_encrypted` (42703). */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const BASELINE = join(
  REPO_ROOT,
  'supabase/migrations/20260813000000_clean_baseline.sql'
)
const ANON_COLUMN_GRANT_MIGRATION = join(
  REPO_ROOT,
  'supabase/migrations/20260814190000_wi6790_cluster_authz_and_guild_config_anon_columns.sql'
)

function baselineGuildConfigColumns(): string[] {
  const sql = readFileSync(BASELINE, 'utf8')
  const start = sql.indexOf('CREATE TABLE public.guild_config (')
  expect(start).toBeGreaterThan(-1)
  const body = sql.slice(start, sql.indexOf('\n);', start))
  return body
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('CONSTRAINT'))
    .map((line) => line.split(/\s+/)[0].replace(/"/g, ''))
}

/** Columns anon may SELECT, from the migration that re-granted them. */
function anonSelectableColumns(): string[] {
  const sql = readFileSync(ANON_COLUMN_GRANT_MIGRATION, 'utf8')
  const match = sql.match(
    /GRANT SELECT \(([^)]*)\) ON public\.guild_config TO anon/
  )
  expect(match).not.toBeNull()
  return (match as RegExpMatchArray)[1].split(',').map((c) => c.trim())
}

function dbDouble() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const result = { data: [], error: null, count: 0 }
  const chain: Record<string, unknown> = {}
  for (const method of [
    'select',
    'eq',
    'gte',
    'lte',
    'or',
    'in',
    'not',
    'is',
    'order',
    'limit'
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    }
  }
  chain.single = () => Promise.resolve({ data: null, error: null })
  chain.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return {
    calls,
    client: {
      from: (table: string) => {
        calls.push({ method: 'from', args: [table] })
        return chain
      }
    }
  }
}

describe('guild_config reads from the health surface', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('names a column that the committed baseline actually has', () => {
    const columns = baselineGuildConfigColumns()
    expect(columns).toContain('api_key_encrypted')
    expect(columns).not.toContain('encrypted_api_key')
  })

  it('never asks anon for guild_config columns it was not granted', () => {
    const anonColumns = anonSelectableColumns()
    expect(anonColumns).not.toContain('auto_sync_enabled')
    expect(anonColumns).not.toContain('consecutive_sync_failures')
  })

  it('analyzeSyncFailurePatterns reads guild_config as the service role, not anon', async () => {
    const double = dbDouble()
    const serviceDb = vi.fn(() => double.client)
    const db = vi.fn(async () => double.client)

    vi.doMock('@tacticus/app-core/daily-alert-summary', () => ({
      addSyncAlert: vi.fn(),
      addInfrastructureAlert: vi.fn(),
      addDatabaseAlert: vi.fn()
    }))
    vi.doMock('@/app/lib/db', () => ({ db, serviceDb }))

    const { analyzeSyncFailurePatterns } =
      await import('@/app/lib/health/sync-health')
    const result = await analyzeSyncFailurePatterns(false)

    expect(result.checked).toBe(true)
    expect(serviceDb).toHaveBeenCalledTimes(1)
    // `db()` is anon from a cron/health surface.
    expect(db).not.toHaveBeenCalled()

    const select = double.calls.find((c) => c.method === 'select')
    expect(select?.args[0]).toContain('auto_sync_enabled')
    expect(select?.args[0]).toContain('consecutive_sync_failures')
  })

  it('checkSecurityEvents filters guild_config on api_key_encrypted', async () => {
    const double = dbDouble()
    const serviceDb = vi.fn(() => double.client)

    vi.doMock('@tacticus/app-core/daily-alert-summary', () => ({
      addSyncAlert: vi.fn(),
      addInfrastructureAlert: vi.fn(),
      addDatabaseAlert: vi.fn()
    }))
    vi.doMock('@/app/lib/db', () => ({ db: vi.fn(), serviceDb }))

    const { checkSecurityEvents } =
      await import('@/app/lib/health/admin-alerts')
    const result = await checkSecurityEvents(false)

    expect(result.checked).toBe(true)

    const notFilters = double.calls
      .filter((c) => c.method === 'not')
      .map((c) => c.args[0])
    expect(notFilters).toContain('api_key_encrypted')
    expect(notFilters).not.toContain('encrypted_api_key')

    const columns = baselineGuildConfigColumns()
    for (const column of notFilters) {
      expect(columns).toContain(column as string)
    }
  })
})
