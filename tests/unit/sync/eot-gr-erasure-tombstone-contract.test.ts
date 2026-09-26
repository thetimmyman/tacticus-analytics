import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isErasureTombstone } from '@/supabase/functions/_shared/player-name-resolution-core'

/** The SQL writer, triggers and TS reader must agree on tombstone shape, or erasure is silently undone. */
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations',
    '20260925160000_eot_gr_data_preserve_erasure_tombstone.sql'
  ),
  'utf8'
)

const PREFIX = '[DELETED_USER_'
const EPOCH_SHAPE = String.raw`'^\[DELETED_USER_[0-9]{13}\]$'`

describe('EOT_GR_data erasure-tombstone contract', () => {
  it('the erasure writer builds an epoch tombstone and records it in the ledger', () => {
    expect(MIGRATION).toContain(`v_tombstone := '${PREFIX}'`)
    expect(MIGRATION).toMatch(
      /INSERT INTO public\.battle_row_erasures AS e[\s\S]*?v_tombstone[\s\S]*?FROM unnest\(v_accepted\)/
    )
    expect(MIGRATION).toContain('array_agg(DISTINCT lower(btrim(fid.pid)))')
    expect(MIGRATION).toContain(`CHECK (tombstone ~ ${EPOCH_SHAPE})`)
  })

  it('the update guard fires on any tombstone and only accepts an epoch re-erasure', () => {
    expect(MIGRATION).toMatch(
      /CREATE (?:OR REPLACE )?TRIGGER trg_eot_gr_data_preserve_erasure_tombstone\s+BEFORE UPDATE ON public\."EOT_GR_data"\s+FOR EACH ROW\s+WHEN \(\s*starts_with\(OLD\."displayName", '\[DELETED_USER_'\)/
    )
    expect(MIGRATION).toContain(`NEW."displayName" ~ ${EPOCH_SHAPE}, false`)
  })

  it('the insert guard consults the ledger on a normalised player id', () => {
    expect(MIGRATION).toMatch(
      /CREATE (?:OR REPLACE )?TRIGGER trg_eot_gr_data_retombstone_erased_insert\s+BEFORE INSERT ON public\."EOT_GR_data"\s+FOR EACH ROW/
    )
    expect(MIGRATION).toContain(
      `WHERE e.player_key = lower(btrim(NEW."userId"))`
    )
  })

  it('the TS reader classifies a writer-shaped value as a tombstone and nothing looser', () => {
    expect(isErasureTombstone(`${PREFIX}${Date.now()}]`)).toBe(true)
    expect(isErasureTombstone('DELETED_USER_lookalike')).toBe(false)
    expect(isErasureTombstone('RealName')).toBe(false)
    expect(isErasureTombstone(null)).toBe(false)
  })
})
