import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS = resolve(__dirname, '../../../supabase/migrations')

/** Cleanup must not treat `is_current = true` as mapping history: departed members are is_current=false. */

/** The last CREATE [OR REPLACE] FUNCTION body for `name`, in version order. */
function effectiveDefinition(name: string): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()

  let found: { file: string; body: string } | null = null
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8')
    const pattern = new RegExp(
      String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`,
      'g'
    )
    for (const match of sql.matchAll(pattern)) {
      const start = match.index ?? 0
      const tagMatch = sql.slice(start).match(/AS\s+(\$\w*\$)/)
      const tag = tagMatch?.[1] ?? '$$'
      const bodyStart = sql.indexOf(tag, start) + tag.length
      const bodyEnd = sql.indexOf(tag, bodyStart)
      found = { file, body: sql.slice(bodyStart, bodyEnd) }
    }
  }

  if (!found) throw new Error(`no definition found for public.${name}`)
  return found
}

const stripComments = (sql: string) => sql.replace(/--.*$/gm, '')

const MAPPING_LIVENESS_FUNCTIONS = [
  'cleanup_incomplete_registrations',
  'cleanup_abandoned_onboarding',
  'cleanup_orphaned_guilds'
] as const

describe('cleanup jobs retain departed-member mappings', () => {
  it.each(MAPPING_LIVENESS_FUNCTIONS)(
    '%s no longer gates its player_mapping probe on is_current',
    (name) => {
      const { body } = effectiveDefinition(name)
      const code = stripComments(body)
      expect(code).toContain('player_mapping')
      expect(code).not.toMatch(/is_current/i)
    }
  )

  it('cleanup_orphaned_guilds deletes only unclaimed mappings', () => {
    const code = stripComments(
      effectiveDefinition('cleanup_orphaned_guilds').body
    )
    const deleteStatement = code
      .slice(code.indexOf('DELETE FROM player_mapping'))
      .split(';')[0]
    expect(deleteStatement).toContain('user_id IS NULL')
    expect(deleteStatement).toContain('ownership_attestation_id IS NULL')
  })

  it('cleanup_orphaned_guilds treats a lapsed claim as a claim', () => {
    const code = stripComments(
      effectiveDefinition('cleanup_orphaned_guilds').body
    )
    expect(code).toContain('ownership_attestation_id IS NOT NULL')
  })

  /** Deactivation NULLs the claim columns, so the probe also uses append-only player_identity_attestations. */
  it('deactivation really does clear both claim columns (the premise of the fix)', () => {
    const code = stripComments(
      effectiveDefinition('deactivate_player_mappings_legacy_impl').body
    )
    const update = code
      .slice(code.indexOf('UPDATE public.player_mapping'))
      .split(';')[0]
    expect(update).toMatch(/user_id\s*=\s*NULL/i)
    expect(update).toMatch(/ownership_attestation_id\s*=\s*NULL/i)
    expect(update).toMatch(/is_current\s*=\s*false/i)
  })

  it('cleanup_orphaned_guilds uses attestation evidence, not just the claim columns', () => {
    const code = stripComments(
      effectiveDefinition('cleanup_orphaned_guilds').body
    )
    expect(code).toContain('player_identity_attestations')
    expect(code).toMatch(
      /NOT EXISTS[\s\S]{0,400}player_identity_attestations[\s\S]{0,200}gc\.guild_code/i
    )
  })

  it('the player_mapping DELETE spares every ever-attested row', () => {
    const code = stripComments(
      effectiveDefinition('cleanup_orphaned_guilds').body
    )
    const deleteStatement = code
      .slice(code.indexOf('DELETE FROM player_mapping'))
      .split(';')[0]
    expect(deleteStatement).toContain('player_identity_attestations')
    expect(deleteStatement).toMatch(/NOT EXISTS/i)
  })

  it('no migration deletes player_mapping rows on an is_current predicate', () => {
    for (const file of readdirSync(MIGRATIONS).filter((entry) =>
      entry.endsWith('.sql')
    )) {
      const code = stripComments(
        readFileSync(resolve(MIGRATIONS, file), 'utf8')
      )
      for (const match of code.matchAll(
        /DELETE\s+FROM\s+(?:public\.)?player_mapping[\s\S]*?;/gi
      )) {
        // is_current may only narrow a delete already proven to be an abandoned stub.
        const isStubOnlyPrune =
          /auto_generated\s+IS\s+NOT\s+TRUE/i.test(match[0]) &&
          /NOT\s+EXISTS[\s\S]{0,200}"EOT_GR_data"/i.test(match[0]) &&
          /NOT\s+EXISTS[\s\S]{0,200}player_identity_attestations/i.test(
            match[0]
          )
        if (isStubOnlyPrune) continue
        expect(
          match[0],
          `${file}: a player_mapping DELETE keyed on is_current`
        ).not.toMatch(/is_current/i)
      }
    }
  })
})

describe('prune_incomplete_player_registrations hardening', () => {
  it('locks candidates FOR UPDATE SKIP LOCKED and re-checks eligibility in the DELETE', () => {
    const code = stripComments(
      effectiveDefinition('prune_incomplete_player_registrations').body
    )
    expect(code).toMatch(/FOR UPDATE OF candidate SKIP LOCKED/)
    const del = code
      .slice(code.indexOf('DELETE FROM public.player_mapping'))
      .split(';')[0]
    expect(del).toContain('victim.id = ANY(v_locked)')
    expect(del).toContain(
      'player_mapping_is_abandoned_registration_stub(victim, v_cutoff)'
    )
    // The racy shape: eligibility only inside an IN-subquery on id.
    expect(del).not.toMatch(/victim\.id\s+IN\s*\(/)
  })

  it('never selects a mapping with player_roster rows, and does not trust auto_generated alone', () => {
    const code = stripComments(
      effectiveDefinition('player_mapping_is_abandoned_registration_stub').body
    )
    expect(code).toMatch(
      /NOT EXISTS \(SELECT 1 FROM public\.player_roster AS r\s+WHERE r\.player_mapping_id = p_row\.id\)/
    )
    expect(code).toContain('p_row.is_active IS NOT FALSE')
    expect(code).toContain('p_row.last_sync_at IS NULL')
    expect(code).toContain('public.player_identity_attestations')
    expect(code).toContain('public.token_burn_state')
  })
})
