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

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath
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

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath
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

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath
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

    const result = await lintSql([join(root, 'migrations/*.sql')], {
      allowlistPath
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.warnings.length, 1)
    assert.ok(result.warnings[0].includes('public.onboarding_jobs'))
    assert.ok(result.warnings[0].includes('prune'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
