import { describe, expect, it } from 'vitest'

import {
  censusFromFiles,
  findDynamicAnonymousGrants,
  findDynamicPrivilegeStatements,
  makeKey,
  normaliseArgType,
  ratchetErrors,
  stripNonCode
} from '@/scripts/security/anon-definer-census.mjs'

type Corridor = { key: string; definedIn: string }

const definer = (name: string, args = '') =>
  `CREATE FUNCTION public.${name}(${args}) RETURNS boolean\n` +
  `    LANGUAGE plpgsql SECURITY DEFINER\n` +
  `    AS $$ BEGIN RETURN true; END; $$;\n`

const invoker = (name: string, args = '') =>
  `CREATE FUNCTION public.${name}(${args}) RETURNS boolean\n` +
  `    LANGUAGE sql STABLE\n` +
  `    AS $$ SELECT true; $$;\n`

const keysOf = (files: { file: string; sql: string }[]) =>
  (censusFromFiles(files).corridors as Corridor[]).map((fn) => fn.key)

describe('anon-definer census: deriving the corridor set', () => {
  it('counts a definer function with NO explicit grant, because the baseline ALTER DEFAULT PRIVILEGES grants anon on creation', () => {
    expect(keysOf([{ file: 'm/1.sql', sql: definer('silent') }])).toEqual([
      'public.silent()'
    ])
  })

  it('does not count a SECURITY INVOKER function — RLS still applies to it', () => {
    expect(
      keysOf([{ file: 'm/1.sql', sql: invoker('open_but_invoker') }])
    ).toEqual([])
  })

  it('treats REVOKE FROM anon alone as still open, because anon inherits PUBLIC', () => {
    const sql =
      definer('half') + 'REVOKE EXECUTE ON FUNCTION public.half() FROM anon;\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual(['public.half()'])
  })

  it('treats REVOKE FROM PUBLIC, anon as closed', () => {
    const sql =
      definer('shut') +
      'REVOKE EXECUTE ON FUNCTION public.shut() FROM PUBLIC, anon;\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual([])
  })

  it('replays files in order, so a later GRANT re-opens an earlier REVOKE', () => {
    expect(
      keysOf([
        {
          file: 'm/1.sql',
          sql:
            definer('reopened') +
            'REVOKE EXECUTE ON FUNCTION public.reopened() FROM PUBLIC, anon;\n'
        },
        {
          file: 'm/2.sql',
          sql: 'GRANT EXECUTE ON FUNCTION public.reopened() TO anon;\n'
        }
      ])
    ).toEqual(['public.reopened()'])
  })

  it('does not let CREATE OR REPLACE reset a revoked ACL, because PostgreSQL does not', () => {
    expect(
      keysOf([
        {
          file: 'm/1.sql',
          sql:
            definer('replaced') +
            'REVOKE EXECUTE ON FUNCTION public.replaced() FROM PUBLIC, anon;\n'
        },
        {
          file: 'm/2.sql',
          sql:
            'CREATE OR REPLACE FUNCTION public.replaced() RETURNS boolean\n' +
            '    LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN false; END; $$;\n'
        }
      ])
    ).toEqual([])
  })

  it('drops a function out of the census when it is dropped', () => {
    const sql = definer('gone') + 'DROP FUNCTION IF EXISTS public.gone();\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual([])
  })

  it('ignores a GRANT that lives in a `--` rollback comment', () => {
    const sql =
      definer('rolled_back') +
      'REVOKE EXECUTE ON FUNCTION public.rolled_back() FROM PUBLIC, anon;\n' +
      '-- GRANT EXECUTE ON FUNCTION public.rolled_back() TO anon;\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual([])
  })

  it('ignores GRANT text that is data inside a dollar-quoted body', () => {
    const sql =
      definer('doc_only') +
      'REVOKE EXECUTE ON FUNCTION public.doc_only() FROM PUBLIC, anon;\n' +
      'CREATE FUNCTION public.helper() RETURNS text LANGUAGE plpgsql AS $$\n' +
      "BEGIN RETURN 'GRANT EXECUTE ON FUNCTION public.doc_only() TO anon';\n" +
      'END; $$;\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual([])
  })

  it('does not publish a SECURITY DEFINER trigger function as an HTTP corridor', () => {
    const census = censusFromFiles([
      {
        file: 'm/1.sql',
        sql:
          'CREATE FUNCTION public.t() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER\n' +
          '    AS $$ BEGIN RETURN NEW; END; $$;\n'
      }
    ])
    expect(census.corridors).toHaveLength(0)
    expect((census.unreachable as Corridor[]).map((fn) => fn.key)).toEqual([
      'public.t()'
    ])
  })

  it('reports a GRANT naming a function no migration creates instead of swallowing it', () => {
    const census = censusFromFiles([
      {
        file: 'm/1.sql',
        sql: 'GRANT EXECUTE ON FUNCTION public.ghost() TO anon;\n'
      }
    ])
    expect(census.unmatchedGrants).toEqual([
      'm/1.sql: GRANT to anon on unknown function public.ghost()'
    ])
  })
})

describe('anon-definer census: signature normalisation', () => {
  it('collapses the three spellings this repository uses into one key', () => {
    const fromDump = makeKey(
      'can_view_playbook',
      'p_cluster_code character varying, p_guild_code text, p_user_id uuid DEFAULT auth.uid()'
    )
    const fromAclLine = makeKey(
      'can_view_playbook',
      'p_cluster_code character varying, p_guild_code text, p_user_id uuid'
    )
    const fromHand = makeKey(
      'can_view_playbook',
      'character varying, text, uuid'
    )
    expect(fromAclLine).toBe(fromDump)
    expect(fromHand).toBe(fromDump)
  })

  it('reaches a function declared with parameter names from a REVOKE written with bare types', () => {
    const census = censusFromFiles([
      {
        file: 'm/1.sql',
        sql:
          'CREATE FUNCTION public.f(p_code varchar(10), p_id uuid DEFAULT auth.uid()) RETURNS boolean\n' +
          '    LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN true; END; $$;\n' +
          'REVOKE EXECUTE ON FUNCTION public.f(character varying, uuid) FROM PUBLIC, anon;\n'
      }
    ])
    expect(census.corridors).toHaveLength(0)
    expect(census.unmatchedGrants).toEqual([])
  })

  it('normalises aliases, typmods, schema qualification and arrays', () => {
    expect(normaliseArgType('p_x varchar(24)')).toBe('character varying')
    expect(normaliseArgType('timestamptz')).toBe('timestamp with time zone')
    expect(normaliseArgType('p_role public.app_role')).toBe('app_role')
    expect(normaliseArgType('p_codes text[]')).toBe('text[]')
    expect(normaliseArgType('int4')).toBe('integer')
  })
})

describe('anon-definer census: lexing', () => {
  it('keeps line numbers stable while blanking comments and literals', () => {
    const sql = "SELECT 1; -- note\n/* block */\nSELECT 'literal';\n"
    const stripped = stripNonCode(sql)
    expect(stripped.split('\n')).toHaveLength(sql.split('\n').length)
    expect(stripped).not.toContain('note')
    expect(stripped).not.toContain('literal')
  })

  it('reports a privilege statement issued as dynamic SQL, and only that', () => {
    expect(
      findDynamicPrivilegeStatements([
        {
          file: 'm/1.sql',
          sql: "  EXECUTE format('REVOKE ALL ON FUNCTION public.x() FROM %I', r);\n"
        },
        {
          file: 'm/2.sql',
          sql: 'GRANT EXECUTE ON FUNCTION public.y() TO anon;\n'
        },
        {
          file: 'm/3.sql',
          sql: "-- EXECUTE 'GRANT EXECUTE ON FUNCTION public.z() TO anon';\n"
        }
      ])
    ).toEqual([
      "m/1.sql:1: EXECUTE format('REVOKE ALL ON FUNCTION public.x() FROM %I', r);"
    ])
  })
})

// ratchetErrors refuses an allowlist without `legacyCutoff`.
const LEGACY_CUTOFF = '20260919120000'

describe('anon-definer ratchet', () => {
  const emptyAllowlist = {
    legacyCutoff: LEGACY_CUTOFF,
    intentionallyPublic: [],
    legacy: []
  }

  it('FAILS when a fixture GRANT to anon lands on a SECURITY DEFINER function that is not on the allowlist', () => {
    const census = censusFromFiles([
      {
        file: 'supabase/migrations/1.sql',
        sql:
          definer('new_corridor', 'p_guild_code text') +
          'GRANT EXECUTE ON FUNCTION public.new_corridor(text) TO anon;\n'
      }
    ])
    const errors = ratchetErrors(census.corridors, emptyAllowlist)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('NEW anon-executable SECURITY DEFINER function')
    expect(errors[0]).toContain('public.new_corridor(text)')
    expect(errors[0]).toContain('supabase/migrations/1.sql')
  })

  it('NEGATIVE CONTROL: the same GRANT on a SECURITY INVOKER function passes', () => {
    const census = censusFromFiles([
      {
        file: 'supabase/migrations/1.sql',
        sql:
          invoker('new_invoker', 'p_guild_code text') +
          'GRANT EXECUTE ON FUNCTION public.new_invoker(text) TO anon;\n'
      }
    ])
    expect(ratchetErrors(census.corridors, emptyAllowlist)).toEqual([])
  })

  it('NEGATIVE CONTROL: the same definer GRANT passes once the function is allowlisted', () => {
    const census = censusFromFiles([
      {
        file: 'supabase/migrations/1.sql',
        sql:
          definer('new_corridor', 'p_guild_code text') +
          'GRANT EXECUTE ON FUNCTION public.new_corridor(text) TO anon;\n'
      }
    ])
    expect(
      ratchetErrors(census.corridors, {
        legacyCutoff: LEGACY_CUTOFF,
        intentionallyPublic: [],
        legacy: ['public.new_corridor(text)']
      })
    ).toEqual([])
  })

  it('NEGATIVE CONTROL: the same definer with the grant revoked in the same migration passes with no allowlist entry', () => {
    const census = censusFromFiles([
      {
        file: 'supabase/migrations/1.sql',
        sql:
          definer('new_corridor', 'p_guild_code text') +
          'REVOKE EXECUTE ON FUNCTION public.new_corridor(text) FROM PUBLIC, anon;\n'
      }
    ])
    expect(ratchetErrors(census.corridors, emptyAllowlist)).toEqual([])
  })

  it('fails on a STALE entry, so the baseline shrinks when a corridor closes', () => {
    const errors = ratchetErrors([], {
      legacyCutoff: LEGACY_CUTOFF,
      intentionallyPublic: [],
      legacy: ['public.already_closed()']
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('STALE allowlist entry')
    expect(errors[0]).toContain('public.already_closed()')
  })

  it('rejects an intentionallyPublic entry whose reason is a rubber stamp', () => {
    const census = censusFromFiles([
      { file: 'supabase/migrations/1.sql', sql: definer('homepage_rpc') }
    ])
    const errors = ratchetErrors(census.corridors, {
      legacyCutoff: LEGACY_CUTOFF,
      intentionallyPublic: [
        { signature: 'public.homepage_rpc()', reason: 'needed' }
      ],
      legacy: []
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('no usable "reason"')
  })

  it('rejects an unsorted legacy list so diffs stay readable', () => {
    const census = censusFromFiles([
      {
        file: 'supabase/migrations/1.sql',
        sql: definer('b_fn') + definer('a_fn')
      }
    ])
    const errors = ratchetErrors(census.corridors, {
      legacyCutoff: LEGACY_CUTOFF,
      intentionallyPublic: [],
      legacy: ['public.b_fn()', 'public.a_fn()']
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('must be sorted by signature')
  })

  it('rejects a signature listed in both lists', () => {
    const census = censusFromFiles([
      { file: 'supabase/migrations/1.sql', sql: definer('both') }
    ])
    const errors = ratchetErrors(census.corridors, {
      legacyCutoff: LEGACY_CUTOFF,
      intentionallyPublic: [
        {
          signature: 'public.both()',
          reason:
            'a reason long enough to clear the rubber-stamp floor in the ratchet'
        }
      ],
      legacy: ['public.both()']
    })
    expect(
      errors.some((error: string) => error.includes('appears twice'))
    ).toBe(true)
  })
})

describe('anon-definer census: privilege forms the ratchet must not miss', () => {
  it('models GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, which reopens every closed definer at once', () => {
    const sql =
      definer('shut') +
      'REVOKE EXECUTE ON FUNCTION public.shut() FROM PUBLIC, anon;\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual([])
    expect(
      keysOf([
        { file: 'm/1.sql', sql },
        {
          file: 'm/2.sql',
          sql: 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;\n'
        }
      ])
    ).toEqual(['public.shut()'])
  })

  it('models the ROUTINES spelling and a grant to PUBLIC the same way', () => {
    const sql =
      definer('shut') +
      'REVOKE EXECUTE ON FUNCTION public.shut() FROM PUBLIC, anon;\n'
    expect(
      keysOf([
        { file: 'm/1.sql', sql },
        {
          file: 'm/2.sql',
          sql: 'GRANT ALL ON ALL ROUTINES IN SCHEMA public TO PUBLIC;\n'
        }
      ])
    ).toEqual(['public.shut()'])
  })

  it('models a schema-wide REVOKE as closing every corridor', () => {
    expect(
      keysOf([
        { file: 'm/1.sql', sql: definer('open_one') + definer('open_two') },
        {
          file: 'm/2.sql',
          sql: 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;\n'
        }
      ])
    ).toEqual([])
  })

  it('ignores a schema-wide grant to another schema', () => {
    const sql =
      definer('shut') +
      'REVOKE EXECUTE ON FUNCTION public.shut() FROM PUBLIC, anon;\n'
    expect(
      keysOf([
        { file: 'm/1.sql', sql },
        {
          file: 'm/2.sql',
          sql: 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon;\n'
        }
      ])
    ).toEqual([])
  })

  it('leaves EXECUTE in place when only the GRANT OPTION is revoked', () => {
    // REVOKE GRANT OPTION FOR removes the right to re-grant, not the privilege.
    const sql =
      definer('still_open') +
      'REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.still_open() FROM anon;\n' +
      'REVOKE EXECUTE ON FUNCTION public.still_open() FROM PUBLIC;\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual(['public.still_open()'])
  })

  it('still closes the corridor for a full REVOKE of both roles', () => {
    const sql =
      definer('really_shut') +
      'REVOKE EXECUTE ON FUNCTION public.really_shut() FROM anon;\n' +
      'REVOKE EXECUTE ON FUNCTION public.really_shut() FROM PUBLIC;\n'
    expect(keysOf([{ file: 'm/1.sql', sql }])).toEqual([])
  })

  it('separates an unmatched GRANT to an anonymous role from an unmatched REVOKE', () => {
    const census = censusFromFiles([
      {
        file: 'supabase/migrations/1.sql',
        sql:
          'GRANT EXECUTE ON FUNCTION public.live_only(uuid) TO anon;\n' +
          'REVOKE EXECUTE ON FUNCTION public.other_live_only() FROM PUBLIC;\n'
      }
    ])
    expect(census.unmatchedGrants).toHaveLength(1)
    expect(census.unmatchedGrants[0]).toContain('public.live_only(uuid)')
    expect(census.unmatchedRevokes).toHaveLength(1)
    expect(census.unmatchedRevokes[0]).toContain('public.other_live_only()')
  })
})

describe('anon-definer census: dynamic privilege SQL', () => {
  const at = (sql: string) => [{ file: 'supabase/migrations/1.sql', sql }]

  it('flags a dynamic GRANT naming anon', () => {
    expect(
      findDynamicAnonymousGrants(
        at("  EXECUTE 'GRANT EXECUTE ON FUNCTION public.f() TO anon';\n")
      )
    ).toHaveLength(1)
  })

  it('flags a dynamic schema-wide GRANT to PUBLIC', () => {
    expect(
      findDynamicAnonymousGrants(
        at(
          "  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC';\n"
        )
      )
    ).toHaveLength(1)
  })

  it('flags a dynamic GRANT whose role list is computed, because nobody can prove it is not anon', () => {
    expect(
      findDynamicAnonymousGrants(
        at(
          "  EXECUTE format('GRANT EXECUTE ON FUNCTION public.f() TO %I', r);\n"
        )
      )
    ).toHaveLength(1)
  })

  it('NEGATIVE CONTROL: a dynamic GRANT to a literal non-anonymous role is not flagged', () => {
    expect(
      findDynamicAnonymousGrants(
        at(
          "  EXECUTE 'GRANT EXECUTE ON FUNCTION public.f() TO service_role';\n"
        )
      )
    ).toEqual([])
  })

  it('NEGATIVE CONTROL: a dynamic REVOKE naming anon is not flagged', () => {
    expect(
      findDynamicAnonymousGrants(
        at(
          "  EXECUTE format('REVOKE ALL ON FUNCTION public.f() FROM %I', r);\n"
        )
      )
    ).toEqual([])
  })

  it('NEGATIVE CONTROL: ordinary DDL is not dynamic', () => {
    expect(
      findDynamicAnonymousGrants(
        at('GRANT EXECUTE ON FUNCTION public.f() TO anon;\n')
      )
    ).toEqual([])
  })
})

describe('anon-definer ratchet: legacy is shrink-only', () => {
  const newCorridor = () =>
    censusFromFiles([
      {
        file: 'supabase/migrations/20260920010000_new.sql',
        sql: definer('fresh_corridor')
      }
    ])

  it('refuses a new corridor parked in legacy', () => {
    const errors = ratchetErrors(newCorridor().corridors, {
      legacyCutoff: LEGACY_CUTOFF,
      intentionallyPublic: [],
      legacy: ['public.fresh_corridor()']
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('after the legacyCutoff')
    expect(errors[0]).toContain('public.fresh_corridor()')
  })

  it('NEGATIVE CONTROL: the same corridor is accepted under intentionallyPublic with a reason', () => {
    expect(
      ratchetErrors(newCorridor().corridors, {
        legacyCutoff: LEGACY_CUTOFF,
        intentionallyPublic: [
          {
            signature: 'public.fresh_corridor()',
            reason:
              'the logged-out landing page calls this to render public guild counts'
          }
        ],
        legacy: []
      })
    ).toEqual([])
  })

  it('NEGATIVE CONTROL: a corridor defined at or before the cutoff stays legal in legacy', () => {
    const census = censusFromFiles([
      {
        file: `supabase/migrations/${LEGACY_CUTOFF}_old.sql`,
        sql: definer('old_corridor')
      }
    ])
    expect(
      ratchetErrors(census.corridors, {
        legacyCutoff: LEGACY_CUTOFF,
        intentionallyPublic: [],
        legacy: ['public.old_corridor()']
      })
    ).toEqual([])
  })

  it('refuses an allowlist with no legacyCutoff at all', () => {
    const errors = ratchetErrors(newCorridor().corridors, {
      intentionallyPublic: [],
      legacy: ['public.fresh_corridor()']
    })
    expect(errors.some((e: string) => e.includes('legacyCutoff'))).toBe(true)
  })
})

describe('the committed allowlist', () => {
  it('matches the census derived from the committed migrations', async () => {
    const {
      censusFromFiles: census,
      readMigrations,
      readAllowlist
    } = await import('@/scripts/security/anon-definer-census.mjs')
    const result = census(readMigrations())
    expect(ratchetErrors(result.corridors, readAllowlist())).toEqual([])
  })
})
