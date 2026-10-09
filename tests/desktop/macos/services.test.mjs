import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeServices } from '../../../apps/desktop/platform/macos/services.mjs'

const server = (portVariable) =>
  `require('node:http').createServer((_, res) => res.end('{}')).listen(Number(process.env.${portVariable}), '127.0.0.1')`
const fakes = {
  initdb: `const fs = require('node:fs'), d = process.argv[process.argv.indexOf('-D') + 1]; fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.writeFileSync(d + '/PG_VERSION', '18', {mode:0o600})`,
  postgres: `const d = process.argv[process.argv.indexOf('-D') + 1]; for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { require('node:fs').writeFileSync(d + '/stopped-by', s); process.exit(0) }); setInterval(() => {}, 1000)`,
  psql: `const sql = require('node:fs').readFileSync(process.argv.at(-1), 'utf8'); if (sql.includes('pg_roles')) console.log('1')`,
  auth: `if (process.argv[2] === 'serve') ${server('PORT')}`,
  postgrest: server('PGRST_SERVER_PORT')
}

async function fixture(t, committed = false, delayedInspection = false) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic services ü '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin'),
    schema = join(root, 'schema'),
    state = join(root, 'state')
  await mkdir(bin)
  await mkdir(schema)
  for (const name of ['canonical-objects.sql', 'authority.sql'])
    await writeFile(join(schema, name), 'SELECT 1;')
  const database = join(root, 'database.json')
  const statements = join(root, 'statements.jsonl')
  await writeFile(
    database,
    JSON.stringify({
      applied: false,
      receipt: 'default administrative connection database',
      canary: 'SYNTHETIC-PERSISTED-ROW'
    })
  )
  if (committed) {
    await writeFile(
      join(schema, 'canonical-objects.sql'),
      "CREATE TYPE public.app_role AS ENUM ('member');"
    )
    await mkdir(state, { mode: 0o700 })
    await mkdir(join(state, 'pgdata'), { mode: 0o700 })
    await writeFile(join(state, 'pgdata/PG_VERSION'), '18', { mode: 0o600 })
    const hash = createHash('sha256')
      .update(await readFile(join(schema, 'canonical-objects.sql')))
      .update(await readFile(join(schema, 'authority.sql')))
      .digest('hex')
    await writeFile(
      database,
      JSON.stringify({
        applied: true,
        receipt: 'desktop-macos-schema:' + hash,
        canary: 'SYNTHETIC-PERSISTED-ROW'
      })
    )
    await writeFile(
      join(state, 'credentials.json'),
      JSON.stringify({
        owner: '1'.repeat(64),
        auth: '2'.repeat(64),
        rest: '3'.repeat(64),
        jwt: '4'.repeat(64)
      }),
      { mode: 0o600 }
    )
  }
  const binaries = { authCwd: root }
  for (const [name, source] of Object.entries(fakes)) {
    binaries[name] = join(bin, name)
    const script =
      name === 'psql'
        ? `
      const fs = require('node:fs');
      const sql = fs.readFileSync(process.argv.at(-1), 'utf8');
      const db = JSON.parse(fs.readFileSync(${JSON.stringify(database)}, 'utf8'));
      if (sql.includes('CREATE TYPE public.app_role') || sql.startsWith('BEGIN;')) {
        fs.appendFileSync(${JSON.stringify(statements)}, 'bootstrap\\n');
        if (db.applied) { console.error('Synthetic duplicate schema'); process.exit(1); }
      }
      if (sql.startsWith('SELECT json_build_object(')) {
        const result=JSON.stringify({database:'postgres',owner:'desktop_owner',receipt:db.receipt,empty:!db.applied});
        if (${delayedInspection}) {
          require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>process.stdout.write(process.argv[1]),50)',result],{stdio:['ignore',1,2]}).unref();
          process.exit(0);
        }
        console.log(result);
      } else if (sql.includes('pg_roles')) console.log('1');
      else if (sql.includes('COMMENT ON DATABASE')) {
        const receipt = /desktop-macos-schema:([a-f0-9]{64})/.exec(sql);
        if (!receipt) process.exit(1);
        db.applied=true; db.receipt='desktop-macos-schema:'+receipt[1];
        fs.writeFileSync(${JSON.stringify(database)}, JSON.stringify(db));
      }
    `
        : source
    await writeFile(binaries[name], `#!${process.execPath}\n${script}\n`)
    await chmod(binaries[name], 0o700)
  }
  return {
    root,
    state,
    binaries,
    schemaDirectory: schema,
    database,
    statements
  }
}

test('reopen recovers a committed schema without its completion file and preserves saved data', async (t) => {
  const f = await fixture(t, true)
  const before = await readFile(f.database)
  const owner = await readFile(join(f.state, 'credentials.json'))
  const services = await nativeServices(f)
  try {
    assert.deepEqual(await readFile(f.database), before)
    assert.deepEqual(await readFile(join(f.state, 'credentials.json')), owner)
    const marker = await readFile(join(f.state, 'schema-version'), 'utf8')
    assert.equal(JSON.parse(before).receipt, 'desktop-macos-schema:' + marker)
    await assert.rejects(readFile(f.statements), { code: 'ENOENT' })
  } finally {
    await services.stop()
  }
})

test('the schema inspection waits for closed output streams before classifying a successful command', async (t) => {
  const f = await fixture(t, true, true)
  const services = await nativeServices(f)
  try {
    const marker = await readFile(join(f.state, 'schema-version'), 'utf8')
    assert.equal(
      JSON.parse(await readFile(f.database)).receipt,
      'desktop-macos-schema:' + marker
    )
    await assert.rejects(readFile(f.statements), { code: 'ENOENT' })
  } finally {
    await services.stop()
  }
})

test('an unattributed database refuses before Auth and releases only the owned service lock', async (t) => {
  const f = await fixture(t, true)
  const db = JSON.parse(await readFile(f.database))
  db.receipt = null
  await writeFile(f.database, JSON.stringify(db))
  const owner = await readFile(join(f.state, 'credentials.json'))
  const launched = []
  await assert.rejects(
    nativeServices({
      ...f,
      confine: (file, args) => {
        launched.push(file)
        return [file, args]
      }
    }),
    {
      code: 'ESCHEMA',
      message: 'Local schema state is incompatible; activation refused'
    }
  )
  assert.equal(launched.includes(f.binaries.auth), false)
  assert.equal(launched.includes(f.binaries.postgrest), false)
  assert.equal(
    await readFile(join(f.state, 'pgdata/stopped-by'), 'utf8'),
    'SIGINT'
  )
  await assert.rejects(readFile(join(f.state, 'running.lock')), {
    code: 'ENOENT'
  })
  await assert.rejects(readFile(join(f.state, 'schema-version')), {
    code: 'ENOENT'
  })
  assert.deepEqual(await readFile(join(f.state, 'credentials.json')), owner)
  assert.deepEqual(JSON.parse(await readFile(f.database)), db)
})

test('stopping local services asks PostgreSQL for a fast shutdown', async (t) => {
  const { state, binaries, schemaDirectory } = await fixture(t)
  const services = await nativeServices({ state, binaries, schemaDirectory })
  await services.stop()
  assert.equal(
    await readFile(join(state, 'pgdata/stopped-by'), 'utf8'),
    'SIGINT'
  )
})

test('confinement wraps every service and keeps the PostgreSQL shutdown', async (t) => {
  const { root, state, binaries, schemaDirectory } = await fixture(t)
  const wrapper = join(root, 'confine'),
    seen = join(root, 'confined.log')
  await writeFile(wrapper, `#!/bin/sh\nbasename "$1" >> '${seen}'\nexec "$@"\n`)
  await chmod(wrapper, 0o700)
  const services = await nativeServices({
    state,
    binaries,
    schemaDirectory,
    confine: (file, args) => [wrapper, [file, ...args]]
  })
  const outside = services.launch(
    binaries.auth,
    ['version'],
    {},
    root,
    true,
    false,
    false
  )
  await new Promise((accept) => outside.once('exit', accept))
  await services.stop()
  assert.equal(
    await readFile(join(state, 'pgdata/stopped-by'), 'utf8'),
    'SIGINT'
  )
  const confined = (await readFile(seen, 'utf8')).trim().split('\n')
  for (const name of ['initdb', 'postgres', 'psql', 'auth', 'postgrest'])
    assert.ok(confined.includes(name), name)
  assert.equal(
    confined.filter((name) => name === 'auth').length,
    2,
    'an explicitly unconfined child bypasses the wrapper'
  )
})
