import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  initdb: `const fs = require('node:fs'), d = process.argv[process.argv.indexOf('-D') + 1]; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(d + '/PG_VERSION', '17')`,
  postgres: `const d = process.argv[process.argv.indexOf('-D') + 1]; for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { require('node:fs').writeFileSync(d + '/stopped-by', s); process.exit(0) }); setInterval(() => {}, 1000)`,
  psql: `const sql = require('node:fs').readFileSync(process.argv.at(-1), 'utf8'); if (sql.includes('pg_roles')) console.log('1')`,
  auth: `if (process.argv[2] === 'serve') ${server('PORT')}`,
  postgrest: server('PGRST_SERVER_PORT')
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic services ü '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin'),
    schema = join(root, 'schema'),
    state = join(root, 'state')
  await mkdir(bin)
  await mkdir(schema)
  for (const name of ['canonical-objects.sql', 'authority.sql'])
    await writeFile(join(schema, name), 'SELECT 1;')
  const binaries = { authCwd: root }
  for (const [name, source] of Object.entries(fakes)) {
    binaries[name] = join(bin, name)
    await writeFile(binaries[name], `#!${process.execPath}\n${source}\n`)
    await chmod(binaries[name], 0o700)
  }
  return { root, state, binaries, schemaDirectory: schema }
}

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
