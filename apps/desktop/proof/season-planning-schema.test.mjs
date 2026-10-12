import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'

const schema = new URL('../local-schema/', import.meta.url)
const migrations = new URL('../../../supabase/migrations/', import.meta.url)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const stripComments = (sql) => sql.replace(/^[ \t]*--[^\n]*\n/gm, '')
const statement = (sql, kind, name) =>
  sql.match(
    new RegExp(
      `CREATE ${kind} public\\.${name}\\s*\\([\\s\\S]*?${kind === 'TABLE' ? '\\n\\);' : '\\n\\$\\$;'}`
    )
  )?.[0]
const baseline = await readFile(
  new URL('20260813000000_clean_baseline.sql', migrations),
  'utf8'
)
const canonical = await readFile(
  new URL('canonical-objects.sql', schema),
  'utf8'
)
const authority = await readFile(new URL('authority.sql', schema), 'utf8')
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', schema), 'utf8')
)

for (const [kind, name] of [
  ['TABLE', 'guild_raid_season_plans'],
  ['TABLE', 'raid_progression_config'],
  ['FUNCTION', 'update_updated_at_column']
]) {
  test(`saved planning preserves canonical ${name} and source provenance`, () => {
    const expected = statement(baseline, kind, name)
    assert(expected)
    assert.equal(statement(canonical, kind, name), stripComments(expected))
    const entries = manifest.objects.filter(
      (entry) => entry.kind === kind && entry.name === name
    )
    assert.equal(entries.length, 1)
    assert.equal(entries[0].canonicalStatementSha256, digest(expected))
    assert.equal(entries[0].sourceFileSha256, digest(baseline))
  })
}
test('saved-plan authority statements preserve their exact canonical constraints and role policies', async () => {
  const sources = [baseline]
  const revision = (await readdir(migrations)).find((name) =>
    name.endsWith('auth_users_fk_actions.sql')
  )
  sources.push(await readFile(new URL(revision, migrations), 'utf8'))
  assert.equal(manifest.seasonPlanningAuthoritySources.length, 18)
  for (const pin of manifest.seasonPlanningAuthoritySources) {
    const source = sources.find((sql) => digest(sql) === pin.sourceFileSha256)
    assert(source)
    // Match the digest-bound source range independently of dump commentary.
    let found = false
    for (const start of source.matchAll(
      /(?:ALTER TABLE|CREATE (?:UNIQUE )?INDEX|CREATE TRIGGER|CREATE POLICY)/g
    )) {
      const range = source.slice(
        start.index,
        source.indexOf(';', start.index) + 1
      )
      if (digest(range) === pin.canonicalStatementSha256) {
        assert(authority.includes(stripComments(range)))
        found = true
      }
    }
    assert(found, pin.name)
  }
  assert(
    /guild_raid_season_plans_created_by_fkey\s+FOREIGN KEY \(created_by\) REFERENCES auth.users\(id\) ON DELETE SET NULL/.test(
      authority
    )
  )
})
test('v17 direct and every admitted older migration are digest-bound and add planning exactly once', async () => {
  const registry = JSON.parse(
    await readFile(new URL('migrations.json', schema), 'utf8')
  )
  assert.equal(manifest.schemaVersion, 17)
  assert.equal(registry.length, 17)
  assert.equal(
    new Set(registry.map((entry) => entry.from)).size,
    registry.length
  )
  assert.equal(
    registry.filter(
      (entry) =>
        entry.from ===
        '175767fb25c7c49fa0262da11563abd0c19f3acd2e0254008aed38746398fa96'
    ).length,
    1
  )
  const target = digest(Buffer.from(canonical + authority))
  for (const entry of registry) {
    const sql = await readFile(
      new URL('migrations/' + entry.file, schema),
      'utf8'
    )
    assert.equal(entry.to, target)
    assert.equal(entry.sha256, digest(sql))
    // The v16 predecessor already contains planning. Its v17 migration adds
    // assignment storage without recreating existing planning objects.
    if (
      entry.from ===
      '755bb30a7f5e541591601f28ccf396809afd9436784dcb91dcebe9a567bcef86'
    ) {
      assert.equal(
        statement(sql, 'TABLE', 'guild_raid_season_plans'),
        undefined
      )
      assert.equal(
        statement(sql, 'TABLE', 'raid_progression_config'),
        undefined
      )
      continue
    }
    for (const [kind, name] of [
      ['TABLE', 'guild_raid_season_plans'],
      ['TABLE', 'raid_progression_config'],
      ['FUNCTION', 'update_updated_at_column']
    ]) {
      assert.equal(statement(sql, kind, name), statement(canonical, kind, name))
      assert.equal(
        [
          ...sql.matchAll(
            new RegExp(`CREATE ${kind} public\\.${name}\\s*\\(`, 'g')
          )
        ].length,
        1
      )
    }
  }
})
test('local supplements describe narrow caller authority and exactly two saved preview capabilities', () => {
  assert.match(
    authority,
    /GRANT SELECT,INSERT,UPDATE,DELETE ON public.guild_raid_season_plans TO authenticated;/
  )
  assert.match(
    authority,
    /GRANT SELECT ON public.raid_progression_config TO authenticated;/
  )
  assert.match(
    authority,
    /GRANT SELECT\(timezone\) ON public.guild_config TO authenticated;/
  )
  assert.match(
    authority,
    /current_user IN \('desktop_owner', 'supabase_auth_admin'\)/
  )
  assert.match(
    authority,
    /current_user <> 'authenticated' OR auth.uid\(\) IS NULL/
  )
  assert.doesNotMatch(authority, /IF auth.uid\(\) IS NULL THEN\s+RETURN NEW/)
  assert.match(authority, /NEW.created_by IS DISTINCT FROM auth.uid\(\)/)
  assert.match(authority, /NEW.created_by IS DISTINCT FROM OLD.created_by/)
  assert.match(
    authority,
    /baseline.guild_code = NEW.guild_code\s+AND baseline.season_id = NEW.season_id/
  )
  assert(
    authority.includes(
      "(baseline.plan->>'season') IS NOT DISTINCT FROM (NEW.plan->>'season')"
    )
  )
  const guardEnd =
    'FOR EACH ROW EXECUTE FUNCTION public.desktop_guard_season_plan_write();'
  const guard = authority.slice(
    authority.indexOf('CREATE FUNCTION public.desktop_guard_season_plan_write'),
    authority.indexOf(guardEnd) + guardEnd.length
  )
  assert.doesNotMatch(guard, /SECURITY DEFINER/)
  assert.match(
    guard,
    /REVOKE ALL ON FUNCTION public.desktop_guard_season_plan_write\(\) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader/
  )
  assert.equal(
    authority.match(/'Saved (?:boss assignments|season planning)','public'/g)
      .length,
    2
  )
  assert(
    authority.includes(
      'ON CONFLICT (feature_key) DO UPDATE\nSET release_stage = EXCLUDED.release_stage, route = EXCLUDED.route;'
    )
  )
  assert(
    manifest.localDifferences.some((text) => text.includes('immutable creator'))
  )
})
