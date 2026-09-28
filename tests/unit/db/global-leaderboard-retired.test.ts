import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The retired `public.global_leaderboard` view's columns (from pg_get_viewdef). */
const VIEW_COLUMNS = [
  'rank',
  'display_name',
  'guild_code',
  'guild_display_name',
  'cluster_display_name',
  'battle_count',
  'total_damage',
  'avg_damage',
  'max_damage',
  'performance_score'
] as const

/** Columns the removed reader used; never on the view, so every call errored. */
const COLUMNS_THE_REMOVED_READER_USED = ['Season', 'encounters'] as const

describe('public.global_leaderboard is retired', () => {
  it('the columns the old reader queried are absent from the view (the defect)', () => {
    for (const column of COLUMNS_THE_REMOVED_READER_USED) {
      expect(VIEW_COLUMNS as readonly string[]).not.toContain(column)
    }
  })

  // Strip comments first: prose naming the removed function would satisfy a bare grep.
  it('no application code reads the dropped view', () => {
    const code = stripComments(read('app/lib/api/cached-responses.ts'))
    expect(code).not.toContain("from('global_leaderboard')")
    expect(code).not.toContain('getCachedLeaderboard')
    expect(code).toContain('export async function warmApiCache')
  })

  it('the served leaderboard still goes through the privacy-aware RPC', () => {
    const homepage = read('app/components/homepage/GlobalLeaderboard.tsx')
    expect(homepage).toContain('get_public_global_leaderboard')
  })

  it('the drop migration exists and targets the General database', () => {
    const migration = read(
      'supabase/migrations/20260904200000_ps308_drop_global_leaderboard_view.sql'
    )
    expect(migration).toContain('-- target-db: general')
    expect(migration).toContain('DROP VIEW public.global_leaderboard RESTRICT')
    expect(migration).toContain(
      'CREATE VIEW public.global_leaderboard WITH (security_invoker='
    )
  })
})
