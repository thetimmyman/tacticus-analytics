import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../local-schema/', import.meta.url)
const baseline = await readFile(
  new URL(
    '../../../supabase/migrations/20260813000000_clean_baseline.sql',
    import.meta.url
  ),
  'utf8'
)
const canonical = await readFile(new URL('canonical-objects.sql', root), 'utf8')
const authority = await readFile(new URL('authority.sql', root), 'utf8')
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', root), 'utf8')
)
const registry = JSON.parse(
  await readFile(new URL('migrations.json', root), 'utf8')
)
const hash = (text) => createHash('sha256').update(text).digest('hex')
const strip = (text) => text.replace(/^[ \t]*--[^\n]*\n/gm, '')
const statement = (sql, kind, name) =>
  sql.match(
    new RegExp(
      `CREATE ${kind} public\\.${name}\\s*\\([\\s\\S]*?${kind === 'TABLE' ? '\\n\\);' : '\\n\\$\\$;'}`
    )
  )?.[0]

for (const [kind, name] of [
  ['TABLE', 'upcoming_season_assignments'],
  ['FUNCTION', 'manage_season_assignments'],
  ['FUNCTION', 'clear_season_assignments']
]) {
  test(`saved assignment storage preserves canonical ${name} and immutable source provenance`, () => {
    const raw = statement(baseline, kind, name)
    assert(raw)
    assert.equal(statement(canonical, kind, name), strip(raw))
    const pins = manifest.objects.filter(
      (pin) => pin.kind === kind && pin.name === name
    )
    assert.equal(pins.length, 1)
    assert.equal(pins[0].sourceFileSha256, hash(baseline))
    assert.equal(pins[0].canonicalStatementSha256, hash(raw))
  })
}
test('saved assignment constraints, indexes, triggers and role policies retain canonical source bytes', () => {
  assert.equal(manifest.savedAssignmentsAuthoritySources.length, 15)
  for (const pin of manifest.savedAssignmentsAuthoritySources) {
    let found = false
    for (const start of baseline.matchAll(
      /(?:ALTER TABLE|CREATE (?:UNIQUE )?INDEX|CREATE TRIGGER|CREATE POLICY)\s/g
    )) {
      const raw = baseline.slice(
        start.index,
        baseline.indexOf(';', start.index) + 1
      )
      if (hash(raw) === pin.canonicalStatementSha256) {
        assert(authority.includes(strip(raw)))
        found = true
      }
    }
    assert(found)
    assert.equal(pin.sourceFileSha256, hash(baseline))
  }
})
test('all admitted schema histories add assignment storage exactly once and target the complete current schema', async () => {
  assert.equal(manifest.schemaVersion, 17)
  assert.equal(registry.length, 17)
  assert.equal(new Set(registry.map((entry) => entry.from)).size, 17)
  assert.equal(
    registry.filter(
      (entry) =>
        entry.from ===
        '755bb30a7f5e541591601f28ccf396809afd9436784dcb91dcebe9a567bcef86'
    ).length,
    1
  )
  for (const entry of registry) {
    const sql = await readFile(
      new URL('migrations/' + entry.file, root),
      'utf8'
    )
    assert.equal(entry.to, hash(canonical + authority))
    assert.equal(entry.sha256, hash(sql))
    for (const [kind, name] of [
      ['TABLE', 'upcoming_season_assignments'],
      ['FUNCTION', 'manage_season_assignments'],
      ['FUNCTION', 'clear_season_assignments']
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
