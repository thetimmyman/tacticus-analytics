import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// These edge functions run with VERIFY_JWT=false but write via the service client,
// so each handler must call requireServiceRole before privileged work.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)

const GUARDED_FUNCTIONS = [
  'sync-modular-workflow',
  // 'purge-old-seasons' is retired: every season is kept.
  'historical-backfill-modular',
  // 'process-backfill-queue' is retired (its RPCs never existed); asserted below.
  'admin-enable-modular-sync',
  'refresh-guild-snapshots'
] as const

function readFn(name: string): string {
  return readFileSync(
    path.join(repoRoot, 'supabase', 'functions', name, 'index.ts'),
    'utf8'
  )
}

describe('sync edge functions enforce the service role', () => {
  for (const name of GUARDED_FUNCTIONS) {
    describe(name, () => {
      const src = readFn(name)

      it('imports requireServiceRole from the shared auth guard', () => {
        expect(src).toMatch(
          /import\s*\{[^}]*requireServiceRole[^}]*\}\s*from\s*['"][^'"]*auth-guard\.ts['"]/
        )
      })

      it('invokes requireServiceRole(req) and returns its 401 when non-null', () => {
        expect(src).toMatch(/requireServiceRole\(\s*req\s*\)/)
        expect(src).toMatch(/if\s*\(\s*authError\s*\)\s*return\s+authError/)
      })

      it('does not fall back to the presence-only requireAuth gate', () => {
        expect(src).not.toMatch(/\brequireAuth\b/)
      })

      it('runs the guard inside the request handler (after the OPTIONS short-circuit)', () => {
        // The guard sits in the serve handler after CORS preflight, not in a skippable helper.
        const handlerIdx = src.search(/serve\(async\s*\(\s*req\b|Deno\.serve\(/)
        const guardIdx = src.search(/requireServiceRole\(\s*req\s*\)/)
        expect(handlerIdx).toBeGreaterThan(-1)
        expect(guardIdx).toBeGreaterThan(handlerIdx)
      })
    })
  }
  it('the retired sync-guild-dispatcher edge function does not reappear', () => {
    expect(() => readFn('sync-guild-dispatcher')).toThrow(/ENOENT/)
  })

  it('the retired purge-old-seasons edge function does not reappear', () => {
    expect(() => readFn('purge-old-seasons')).toThrow(/ENOENT/)
  })

  it('the retired process-backfill-queue edge function does not reappear', () => {
    // A revival needs its RPCs and a guard review, not a silent re-add.
    expect(() => readFn('process-backfill-queue')).toThrow(/ENOENT/)
  })
})
