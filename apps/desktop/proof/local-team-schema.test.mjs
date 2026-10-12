import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const schema = new URL('../local-schema/', import.meta.url)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const statement = (sql) =>
  sql.match(/CREATE FUNCTION public.get_guild_team_roster\(.*?\n\$\$;/s)?.[0]

test('local team projection preserves the pinned canonical member and officer contract', async () => {
  const source = await readFile(
    new URL(
      '../../../supabase/migrations/20260813000000_clean_baseline.sql',
      import.meta.url
    ),
    'utf8'
  )
  const canonical = await readFile(
    new URL('canonical-objects.sql', schema),
    'utf8'
  )
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', schema), 'utf8')
  )
  const entry = manifest.objects.filter(
    (object) => object.name === 'get_guild_team_roster'
  )
  assert.equal(entry.length, 1)
  assert.equal(statement(canonical), statement(source))
  assert.equal(
    digest(statement(canonical)),
    'b1df99fb7ac43f8ce0cc2ea1a137ee74c463a97cd351c48ecadf59998f73a604'
  )
  assert.equal(entry[0].canonicalStatementSha256, digest(statement(source)))
  assert.equal(entry[0].sourceFileSha256, digest(source))
})

test('every admitted prior schema upgrades directly to the exact current bytes', async () => {
  const canonical = await readFile(new URL('canonical-objects.sql', schema))
  const authority = await readFile(new URL('authority.sql', schema))
  const target = digest(Buffer.concat([canonical, authority]))
  const registry = JSON.parse(
    await readFile(new URL('migrations.json', schema), 'utf8')
  )
  assert.equal(
    new Set(registry.map((entry) => entry.from)).size,
    registry.length
  )
  const previous = registry.find(
    (entry) =>
      entry.from ===
      'fdfb8fe209d71d2f8fdce56c7ccaaebc1e0c49ac83258ef39688f2949a2e2aea'
  )
  assert.equal(previous?.file, '013-local-guild-teams.sql')
  for (const entry of registry) {
    const sql = await readFile(
      new URL('migrations/' + entry.file, schema),
      'utf8'
    )
    assert.equal(entry.to, target)
    assert.equal(entry.sha256, digest(sql))
    if (
      [
        '62875299367a965d8ec5596d3a4b5aaa28b091cd5b36f3cabd3fe1f208a0c952',
        '175767fb25c7c49fa0262da11563abd0c19f3acd2e0254008aed38746398fa96',
        '755bb30a7f5e541591601f28ccf396809afd9436784dcb91dcebe9a567bcef86'
      ].includes(entry.from)
    ) {
      // This installed schema already contains the team projection and role.
      // Its next migration must retain them without trying to create them twice.
      assert.equal(statement(sql), undefined)
      assert.equal(sql.split('CREATE ROLE desktop_team_reader ').length - 1, 0)
    } else {
      assert.equal(statement(sql), statement(canonical.toString()))
      assert.equal(sql.split('CREATE ROLE desktop_team_reader ').length - 1, 1)
    }
  }
})
