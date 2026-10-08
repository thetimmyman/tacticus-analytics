import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const schema = new URL('../local-schema/', import.meta.url)
const baseline = new URL(
  '../../../supabase/migrations/20260813000000_clean_baseline.sql',
  import.meta.url
)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const executableStatement = (sql) => sql.replace(/^[ \t]*--[^\n]*\n/gm, '')
const selectStatement = (sql, kind, name) => {
  const ending = kind === 'TABLE' ? '\\n\\);' : '\\n(?:\\$\\$|\\$_\\$);'
  return sql.match(
    new RegExp(`CREATE ${kind} public.${name}\\s*\\([\\s\\S]*?${ending}`)
  )?.[0]
}

for (const [kind, name] of [
  ['TABLE', 'season_calendar'],
  ['FUNCTION', 'calculate_player_tokens_by_user'],
  ['FUNCTION', 'project_token_snapshot'],
  ['FUNCTION', 'get_player_token_state'],
  ['TABLE', 'boss_target_tokens'],
  ['TABLE', 'herald_boss_config'],
  ['TABLE', 'upcoming_season_bosses'],
  ['FUNCTION', 'boss_target_tokens_touch_updated_at'],
  ['FUNCTION', 'get_cluster_latest_season']
]) {
  test(`local raid management preserves canonical ${name} and its provenance`, async () => {
    const source = await readFile(baseline, 'utf8')
    const canonical = await readFile(
      new URL('canonical-objects.sql', schema),
      'utf8'
    )
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', schema), 'utf8')
    )
    const expected = selectStatement(source, kind, name)
    assert(expected, 'Canonical statement exists')
    assert.equal(
      selectStatement(canonical, kind, name),
      executableStatement(expected)
    )
    const entries = manifest.objects.filter(
      (entry) => entry.kind === kind && entry.name === name
    )
    assert.equal(entries.length, 1)
    assert.equal(entries[0].canonicalStatementSha256, digest(expected))
    assert.equal(entries[0].sourceFileSha256, digest(source))
  })
}

test('cached token adapter preserves canonical math and authorization with explicit provenance changes', async () => {
  const source = await readFile(baseline, 'utf8')
  const authority = await readFile(new URL('authority.sql', schema), 'utf8')
  const expected = selectStatement(source, 'FUNCTION', 'get_player_token_state')
    .replace(
      'CREATE FUNCTION public.get_player_token_state(',
      'CREATE FUNCTION public.desktop_get_player_token_state('
    )
    .replace(
      'm.tacticus_api_key_encrypted is not null\n        and coalesce(m.api_key_is_valid, false)\n        and m.last_sync_tokens is not null',
      'm.last_sync_tokens is not null'
    )
    .replace("'live'::text", "'cached'::text")
    .replace(
      "if v_requester_role not in ('officer', 'admin') then",
      "if lower(v_requester_role) not in ('officer', 'leader') then"
    )
    .replace(
      'membership, or officer/admin in the same cluster.',
      'membership, or officer/leader in the same cluster.'
    )
  assert.equal(
    selectStatement(authority, 'FUNCTION', 'desktop_get_player_token_state'),
    executableStatement(expected)
  )
})

test('the installed previous schema has a direct digest-bound raid-management migration', async () => {
  const registry = JSON.parse(
    await readFile(new URL('migrations.json', schema), 'utf8')
  )
  const old = registry.filter(
    (entry) =>
      entry.from ===
      '62875299367a965d8ec5596d3a4b5aaa28b091cd5b36f3cabd3fe1f208a0c952'
  )
  assert.equal(old.length, 1)
  const canonical = await readFile(new URL('canonical-objects.sql', schema))
  const authority = await readFile(new URL('authority.sql', schema))
  assert.equal(old[0].to, digest(Buffer.concat([canonical, authority])))
  const migration = await readFile(new URL('migrations/' + old[0].file, schema))
  assert.equal(old[0].sha256, digest(migration))
})

test('target write authority preserves the latest canonical policy and its source pin', async () => {
  const source = await readFile(
    new URL(
      '../../../supabase/migrations/20260824130000_close_ban_and_pr56_review_boundaries.sql',
      import.meta.url
    ),
    'utf8'
  )
  const authority = await readFile(new URL('authority.sql', schema), 'utf8')
  assert.equal(
    digest(source),
    '771419e5fca330e7baac4a7c3f3c6b665fa6b6a123922098b686dcc6aca1e463'
  )
  const policy = (sql) =>
    sql.match(/CREATE POLICY boss_target_tokens_write[\s\S]*?\n  \);/)?.[0]
  assert(policy(source))
  assert.equal(policy(authority), policy(source))
})
