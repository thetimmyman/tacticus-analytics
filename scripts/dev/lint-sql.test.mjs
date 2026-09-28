import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { lintSql } from './lint-sql.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ta-lint-sql-'))
  mkdirSync(join(root, 'migrations'), { recursive: true })
  return root
}

function writeAllowlist(root, lines) {
  const allowlistPath = join(root, 'allowlist.txt')
  writeFileSync(
    allowlistPath,
    '# fixture allowlist\n' + lines.join('\n') + '\n'
  )
  return allowlistPath
}

function writePgrstReloadAllowlist(root, lines) {
  const allowlistPath = join(root, 'pgrst-allowlist.txt')
  writeFileSync(
    allowlistPath,
    '# fixture pgrst-reload allowlist\n' + lines.join('\n') + '\n'
  )
  return allowlistPath
}

test('an allowlisted RLS-without-policy table passes', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_ok.sql'),
      [
        'CREATE TABLE public.function_locks (id uuid PRIMARY KEY);',
        'ALTER TABLE public.function_locks ENABLE ROW LEVEL SECURITY;'
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, ['public.function_locks'])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.warnings, [])
    assert.equal(result.rlsNoPolicyCount, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a policy-less RLS table not in the allowlist fails, naming the table and the allowlist path', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_probe.sql'),
      [
        'CREATE TABLE public.rls_probe_secrets (id uuid PRIMARY KEY);',
        'ALTER TABLE public.rls_probe_secrets ENABLE ROW LEVEL SECURITY;'
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.equal(result.errors.length, 1)
    assert.ok(result.errors[0].includes('public.rls_probe_secrets'))
    assert.ok(result.errors[0].includes(allowlistPath))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a table with a matching CREATE POLICY is never flagged, allowlisted or not', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_policy.sql'),
      [
        'CREATE TABLE public.user_bans (id uuid PRIMARY KEY);',
        'ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;',
        'CREATE POLICY user_bans_read ON public.user_bans FOR SELECT USING (true);'
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.rlsNoPolicyCount, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stale allowlist entry (policy since added) produces a prune warning, not an error', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_now_policied.sql'),
      [
        'CREATE TABLE public.onboarding_jobs (id uuid PRIMARY KEY);',
        'ALTER TABLE public.onboarding_jobs ENABLE ROW LEVEL SECURITY;',
        'CREATE POLICY onboarding_jobs_read ON public.onboarding_jobs FOR SELECT USING (true);'
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, ['public.onboarding_jobs'])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.warnings.length, 1)
    assert.ok(result.warnings[0].includes('public.onboarding_jobs'))
    assert.ok(result.warnings[0].includes('prune'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a migration creating a public function with no NOTIFY pgrst fails, naming the file and the allowlist path', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_new_fn.sql'),
      [
        'CREATE FUNCTION public.lint_sql_probe_fn() RETURNS void',
        '    LANGUAGE sql AS $$ SELECT 1; $$;'
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.equal(result.errors.length, 1)
    assert.ok(result.errors[0].includes('001_new_fn.sql'))
    assert.ok(result.errors[0].includes(pgrstReloadAllowlistPath))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a migration dropping a public function with no NOTIFY pgrst also fails', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_drop_fn.sql'),
      'DROP FUNCTION IF EXISTS public.lint_sql_probe_fn();'
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.equal(result.errors.length, 1)
    assert.ok(result.errors[0].includes('001_drop_fn.sql'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a migration creating a public function WITH NOTIFY pgrst is never flagged', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_new_fn_ok.sql'),
      [
        'BEGIN;',
        'CREATE FUNCTION public.lint_sql_probe_fn() RETURNS void',
        '    LANGUAGE sql AS $$ SELECT 1; $$;',
        'COMMIT;',
        "NOTIFY pgrst, 'reload schema';"
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.pgrstReloadMissingCount, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an allowlisted function migration missing NOTIFY pgrst is tolerated', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_grandfathered.sql'),
      [
        'CREATE FUNCTION public.lint_sql_probe_fn() RETURNS void',
        '    LANGUAGE sql AS $$ SELECT 1; $$;'
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [
      '001_grandfathered.sql'
    ])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.pgrstReloadMissingCount, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stale pgrst-reload allowlist entry (NOTIFY since added) produces a prune warning, not an error', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/001_now_fixed.sql'),
      [
        'CREATE FUNCTION public.lint_sql_probe_fn() RETURNS void',
        '    LANGUAGE sql AS $$ SELECT 1; $$;',
        "NOTIFY pgrst, 'reload schema';"
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [
      '001_now_fixed.sql'
    ])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.warnings.length, 1)
    assert.ok(result.warnings[0].includes('001_now_fixed.sql'))
    assert.ok(result.warnings[0].includes('prune'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the clean-baseline dump is exempt even though it creates functions with no NOTIFY pgrst', async () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'migrations/20260813000000_clean_baseline.sql'),
      [
        'CREATE FUNCTION public.lint_sql_probe_fn() RETURNS void',
        '    LANGUAGE sql AS $$ SELECT 1; $$;'
      ].join('\n')
    )
    const allowlistPath = writeAllowlist(root, [])
    const pgrstReloadAllowlistPath = writePgrstReloadAllowlist(root, [])

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath,
      pgrstReloadAllowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.pgrstReloadMissingCount, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

async function lintNewTableMigration(name, lines) {
  const root = fixture()
  try {
    writeFileSync(join(root, 'migrations', name), lines.join('\n'))
    return await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath: writeAllowlist(root, []),
      pgrstReloadAllowlistPath: writePgrstReloadAllowlist(root, [])
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const POLICY_LINE =
  'CREATE POLICY probe_read ON public.lint_probe FOR SELECT TO authenticated USING (true);'

test('a new public table with RLS and an explicit GRANT passes', async () => {
  const result = await lintNewTableMigration('20990101000000_new_table.sql', [
    'CREATE TABLE IF NOT EXISTS public.lint_probe (id uuid PRIMARY KEY, note text);',
    'ALTER TABLE public.lint_probe ENABLE ROW LEVEL SECURITY;',
    POLICY_LINE,
    'REVOKE ALL ON TABLE public.lint_probe FROM PUBLIC, anon, authenticated;',
    'GRANT SELECT (id, note) ON public.lint_probe TO authenticated;',
    'GRANT ALL ON TABLE public.lint_probe TO service_role;'
  ])
  assert.deepEqual(result.errors, [])
})

test('a new public table with no GRANT fails, even with RLS on', async () => {
  const result = await lintNewTableMigration('20990101000000_new_table.sql', [
    'CREATE TABLE public.lint_probe (id uuid PRIMARY KEY);',
    'ALTER TABLE public.lint_probe ENABLE ROW LEVEL SECURITY;',
    POLICY_LINE,
    '-- GRANT SELECT ON public.lint_probe TO authenticated;'
  ])
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /public\.lint_probe is created without an explicit GRANT/)
})

test('a new public table with a GRANT but RLS off fails', async () => {
  const result = await lintNewTableMigration('20990101000000_new_table.sql', [
    'CREATE TABLE lint_probe (id uuid PRIMARY KEY);',
    'GRANT SELECT ON lint_probe TO authenticated;'
  ])
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /public\.lint_probe .*ENABLE ROW LEVEL SECURITY/)
})

test('new-table grant rule ignores other schemas, temp tables, partitions and older migrations', async () => {
  const ignored = [
    'CREATE TABLE internal.lint_probe (id uuid PRIMARY KEY);',
    'CREATE TEMP TABLE lint_scratch (id uuid);',
    'CREATE TABLE public.lint_probe_2099 PARTITION OF public.lint_parent FOR VALUES IN (1);'
  ]
  const newer = await lintNewTableMigration('20990101000000_other_schemas.sql', ignored)
  assert.deepEqual(newer.errors, [])

  const older = await lintNewTableMigration('20260101000000_legacy.sql', [
    'CREATE TABLE public.lint_probe (id uuid PRIMARY KEY);'
  ])
  assert.deepEqual(older.errors, [])
})
