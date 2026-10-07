import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { qualifyRecovery } from '../../../apps/desktop/platform/macos/recovery.mjs'

async function fixture(options = {}) {
  const state = await mkdtemp(join(tmpdir(), 'synthetic recovery ü ')),
    databases = new Set(['postgres', 'desktop_macos_restore']),
    sql = [],
    tools = []
  await writeFile(
    join(state, 'credentials.json'),
    JSON.stringify({ owner: 'SYNTHETIC-LOCAL-PASSWORD' }),
    { mode: 0o600 }
  )
  const services = {
    ports: { db: 15432 },
    psql: async (statement) => {
      sql.push(statement)
      const match =
        /^(CREATE|DROP) DATABASE (desktop_macos_restore_[a-f0-9]{32})(?: WITH \(FORCE\))?;$/.exec(
          statement
        )
      assert.ok(
        match,
        'Only this invocation owned disposable database is touched'
      )
      const [, operation, name] = match
      if (operation === 'CREATE') {
        if (options.createFails) throw new Error('Creation refused')
        assert.equal(databases.has(name), false)
        databases.add(name)
      } else {
        assert.ok(databases.has(name))
        if (options.dropFails) throw new Error('Cleanup interrupted')
        databases.delete(name)
      }
    }
  }
  const run = async (file, args, environment) => {
    assert.equal(environment.PGPASSWORD, 'SYNTHETIC-LOCAL-PASSWORD')
    tools.push({ file, args })
    if (file.endsWith('/pg_dump')) {
      assert.equal(args[args.indexOf('-d') + 1], 'postgres')
      await writeFile(args[args.indexOf('--file') + 1], 'synthetic backup')
    } else {
      const database = args[args.indexOf('-d') + 1]
      assert.ok(databases.has(database))
      if (file.endsWith('/pg_restore') && options.restoreFails)
        throw new Error('Restore interrupted')
      if (file.endsWith('/psql'))
        assert.match(
          await readFile(args.at(-1), 'utf8'),
          /Restored fixture differs/
        )
    }
  }
  return { state, databases, sql, tools, services, run }
}

async function qualify(f) {
  return qualifyRecovery({
    services: f.services,
    postgres: '/synthetic/bundled-postgres',
    state: f.state,
    run: f.run
  })
}

test('recovery restores/probes one unique owned database and leaves active/older databases intact', async () => {
  const f = await fixture()
  try {
    const result = await qualify(f),
      database = f.sql[0].split(' ')[2].slice(0, -1)
    assert.equal(f.sql[1], `DROP DATABASE ${database} WITH (FORCE);`)
    assert.deepEqual([...f.databases], ['postgres', 'desktop_macos_restore'])
    assert.deepEqual(
      f.tools.map(({ file }) => file),
      [
        '/synthetic/bundled-postgres/bin/pg_dump',
        '/synthetic/bundled-postgres/bin/pg_restore',
        '/synthetic/bundled-postgres/bin/psql'
      ]
    )
    assert.deepEqual(
      f.tools.slice(1).map(({ args }) => args[args.indexOf('-d') + 1]),
      [database, database]
    )
    assert.equal(
      result.sha256,
      createHash('sha256').update('synthetic backup').digest('hex')
    )
    assert.equal(result.vault, 'excluded')
  } finally {
    await rm(f.state, { recursive: true, force: true })
  }
})

test('restore failure still drops only its own disposable database', async () => {
  const f = await fixture({ restoreFails: true })
  try {
    await assert.rejects(qualify(f), /Restore interrupted/)
    assert.equal(f.sql.length, 2)
    assert.match(
      f.sql[1],
      /^DROP DATABASE desktop_macos_restore_[a-f0-9]{32} WITH \(FORCE\);$/
    )
    assert.deepEqual([...f.databases], ['postgres', 'desktop_macos_restore'])
  } finally {
    await rm(f.state, { recursive: true, force: true })
  }
})

test('leftover from interrupted cleanup cannot collide with the next qualification', async () => {
  const options = { dropFails: true },
    f = await fixture(options)
  try {
    await assert.rejects(qualify(f), /Cleanup interrupted/)
    const leftover = f.sql[0].split(' ')[2].slice(0, -1)
    assert.ok(f.databases.has(leftover))
    options.dropFails = false
    await qualify(f)
    const next = f.sql[2].split(' ')[2].slice(0, -1)
    assert.notEqual(next, leftover)
    assert.equal(f.sql[3], `DROP DATABASE ${next} WITH (FORCE);`)
    assert.ok(f.databases.has(leftover))
    assert.equal(f.databases.has(next), false)
    assert.ok(f.databases.has('postgres'))
  } finally {
    await rm(f.state, { recursive: true, force: true })
  }
})

test('creation refusal never drops a database this invocation did not create', async () => {
  const f = await fixture({ createFails: true })
  try {
    await assert.rejects(qualify(f), /Creation refused/)
    assert.equal(f.sql.length, 1)
    assert.deepEqual([...f.databases], ['postgres', 'desktop_macos_restore'])
  } finally {
    await rm(f.state, { recursive: true, force: true })
  }
})
