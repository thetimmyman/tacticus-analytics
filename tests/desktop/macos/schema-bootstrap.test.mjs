import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  chmod,
  symlink,
  link,
  readdir,
  lstat
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { prepareSchemaBootstrap } from '../../../apps/desktop/platform/macos/schema-bootstrap.mjs'

const canonical = "CREATE TYPE public.app_role AS ENUM ('member');"
const authority = 'REVOKE ALL ON SCHEMA public FROM PUBLIC;'
const target = createHash('sha256')
  .update(canonical)
  .update(authority)
  .digest('hex')
// PostgreSQL 18.6 initdb's make_postgres() supplies this ordinary comment.
const initdbComment = 'default administrative connection database'
const journal = JSON.stringify({
  format: 'desktop-macos-schema-bootstrap/v1',
  target
})
const schemaRefusal = {
  code: 'ESCHEMA',
  message: 'Local schema state is incompatible; activation refused'
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic bootstrap ü '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state'),
    schemaDirectory = join(root, 'schema')
  await mkdir(state, { mode: 0o700 })
  await mkdir(schemaDirectory)
  await writeFile(join(schemaDirectory, 'canonical-objects.sql'), canonical)
  await writeFile(join(schemaDirectory, 'authority.sql'), authority)
  const database = {
    database: 'postgres',
    owner: 'desktop_owner',
    receipt: null,
    empty: true
  }
  const transactions = []
  const psql = async (sql) => {
    if (sql.startsWith('SELECT json_build_object('))
      return JSON.stringify(database)
    assert.match(sql, /^BEGIN;[\s\S]*COMMIT;$/)
    const receipt = /'desktop-macos-schema:([a-f0-9]{64})'/.exec(sql)
    assert.ok(receipt)
    assert.ok(database.receipt === null || database.receipt === initdbComment)
    assert.equal(database.empty, true)
    transactions.push(sql)
    database.receipt = 'desktop-macos-schema:' + receipt[1]
    database.empty = false
  }
  const pgdata = async () => {
    await mkdir(join(state, 'pgdata'), { mode: 0o700 })
    await writeFile(join(state, 'pgdata/PG_VERSION'), '18', { mode: 0o600 })
  }
  return { state, schemaDirectory, database, transactions, psql, pgdata }
}

test('a bootstrap journal resumes before SQL commit, then a second open does not replay DDL', async (t) => {
  const f = await fixture(t)
  await prepareSchemaBootstrap(f)
  const before = await readFile(join(f.state, 'schema-bootstrap.json'))
  await f.pgdata()
  const resumed = await prepareSchemaBootstrap(f)
  await resumed.inspect(f.psql)
  await resumed.complete(f.psql)
  assert.equal(f.transactions.length, 1)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
  await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
    code: 'ENOENT'
  })
  const reopened = await prepareSchemaBootstrap(f)
  await reopened.inspect(f.psql)
  await reopened.complete(f.psql)
  assert.equal(f.transactions.length, 1)
  assert.equal(JSON.parse(before).target, target)
})

test('bootstrap applies the exact schema bytes retained during preparation', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await writeFile(join(f.schemaDirectory, 'authority.sql'), 'SELECT 42;')
  await prepared.inspect(f.psql)
  await prepared.complete(f.psql)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
  assert.ok(f.transactions[0].includes(authority))
  assert.equal(f.transactions[0].includes('SELECT 42;'), false)
})

test('schema input with invalid UTF-8 refuses before creating bootstrap intent', async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.schemaDirectory, 'authority.sql'), Buffer.from([0xff]))
  await assert.rejects(prepareSchemaBootstrap(f), { code: 'ESCHEMA' })
  await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
    code: 'ENOENT'
  })
})

test('a conflicting completion file appearing during SQL commit is preserved and refused', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await prepared.inspect(f.psql)
  const conflicting = 'f'.repeat(64)
  await assert.rejects(
    prepared.complete(async (sql) => {
      await f.psql(sql)
      await writeFile(join(f.state, 'schema-version'), conflicting, {
        mode: 0o600
      })
    }),
    { code: 'ESCHEMA' }
  )
  assert.equal(
    await readFile(join(f.state, 'schema-version'), 'utf8'),
    conflicting
  )
  assert.equal(
    JSON.parse(await readFile(join(f.state, 'schema-bootstrap.json'))).target,
    target
  )
  assert.equal(f.database.receipt, 'desktop-macos-schema:' + target)
})

test('a committed receipt retires its interrupted journal without replaying SQL', async (t) => {
  const f = await fixture(t)
  await f.pgdata()
  await writeFile(join(f.state, 'schema-bootstrap.json'), journal, {
    mode: 0o600
  })
  f.database.receipt = 'desktop-macos-schema:' + target
  f.database.empty = false
  const recovery = await prepareSchemaBootstrap(f)
  await recovery.inspect(f.psql)
  await recovery.complete(f.psql)
  assert.equal(f.transactions.length, 0)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
  await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
    code: 'ENOENT'
  })
})

test('an interrupted journal retirement is safe with the durable completion file already present', async (t) => {
  const f = await fixture(t)
  await f.pgdata()
  await writeFile(join(f.state, 'schema-bootstrap.json'), journal, {
    mode: 0o600
  })
  await writeFile(join(f.state, 'schema-version'), target, { mode: 0o600 })
  f.database.receipt = 'desktop-macos-schema:' + target
  f.database.empty = false
  const recovery = await prepareSchemaBootstrap(f)
  await recovery.inspect(f.psql)
  await recovery.complete(f.psql)
  assert.equal(f.transactions.length, 0)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
  await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
    code: 'ENOENT'
  })
})

test('a legitimate legacy marker opens without adopting a transaction receipt or changing files', async (t) => {
  const f = await fixture(t)
  await f.pgdata()
  await writeFile(join(f.state, 'schema-version'), target, { mode: 0o600 })
  f.database.empty = false
  const before = await readFile(join(f.state, 'schema-version'))
  const legacy = await prepareSchemaBootstrap(f)
  await legacy.inspect(f.psql)
  await legacy.complete(f.psql)
  assert.equal(f.database.receipt, null)
  assert.equal(f.transactions.length, 0)
  assert.deepEqual(await readFile(join(f.state, 'schema-version')), before)
  await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
    code: 'ENOENT'
  })
})

test('the exact initdb database comment is not mistaken for a foreign bootstrap receipt', async (t) => {
  for (const legacy of [false, true])
    await t.test(`legacy=${legacy}`, async (t) => {
      const f = await fixture(t)
      f.database.receipt = initdbComment
      if (legacy) {
        await f.pgdata()
        f.database.empty = false
        await writeFile(join(f.state, 'schema-version'), target, {
          mode: 0o600
        })
      }
      const prepared = await prepareSchemaBootstrap(f)
      await prepared.inspect(f.psql)
      await prepared.complete(f.psql)
      assert.equal(f.transactions.length, legacy ? 0 : 1)
      assert.equal(
        f.database.receipt,
        legacy ? initdbComment : 'desktop-macos-schema:' + target
      )
      assert.equal(
        await readFile(join(f.state, 'schema-version'), 'utf8'),
        target
      )
    })
})

test('an unknown existing database is never adopted from empty or matching-looking objects', async (t) => {
  for (const empty of [true, false])
    await t.test(`empty=${empty}`, async (t) => {
      const f = await fixture(t)
      await f.pgdata()
      f.database.empty = empty
      const unknown = await prepareSchemaBootstrap(f)
      await assert.rejects(unknown.inspect(f.psql), schemaRefusal)
      assert.equal(f.transactions.length, 0)
      assert.deepEqual((await readdir(f.state)).sort(), ['pgdata'])
    })
})

test('journal authority never permits replay over unattributed application objects', async (t) => {
  const f = await fixture(t)
  await f.pgdata()
  await writeFile(join(f.state, 'schema-bootstrap.json'), journal, {
    mode: 0o600
  })
  f.database.empty = false
  const unknown = await prepareSchemaBootstrap(f)
  await assert.rejects(unknown.inspect(f.psql), schemaRefusal)
  assert.equal(f.transactions.length, 0)
  assert.equal(
    await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
    journal
  )
})

test('an SQL rollback preserves bootstrap intent and can resume without a completion marker', async (t) => {
  const f = await fixture(t)
  const failed = await prepareSchemaBootstrap(f)
  await f.pgdata()
  await failed.inspect(f.psql)
  await assert.rejects(
    failed.complete(async () => {
      throw new Error('SYNTHETIC-RAW-SQL-OUTPUT')
    }),
    schemaRefusal
  )
  assert.equal(f.database.receipt, null)
  assert.equal(
    await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
    journal
  )
  await assert.rejects(readFile(join(f.state, 'schema-version')), {
    code: 'ENOENT'
  })
  const resumed = await prepareSchemaBootstrap(f)
  await resumed.inspect(f.psql)
  await resumed.complete(f.psql)
  assert.equal(f.transactions.length, 1)
})

test('loss of the SQL acknowledgement after commit recovers by receipt without duplicate DDL', async (t) => {
  const f = await fixture(t)
  const failed = await prepareSchemaBootstrap(f)
  await f.pgdata()
  await failed.inspect(f.psql)
  await assert.rejects(
    failed.complete(async (sql) => {
      await f.psql(sql)
      throw new Error('SYNTHETIC-CONNECTION-LOST')
    }),
    schemaRefusal
  )
  assert.equal(f.database.receipt, 'desktop-macos-schema:' + target)
  await assert.rejects(readFile(join(f.state, 'schema-version')), {
    code: 'ENOENT'
  })
  const recovered = await prepareSchemaBootstrap(f)
  await recovered.inspect(f.psql)
  await recovered.complete(f.psql)
  assert.equal(f.transactions.length, 1)
})

test('a real filesystem failure after commit retains intent for a later safe reopen', async (t) => {
  const f = await fixture(t)
  const displaced = f.state + '-displaced'
  const failed = await prepareSchemaBootstrap(f)
  await f.pgdata()
  await failed.inspect(f.psql)
  await assert.rejects(
    failed.complete(async (sql) => {
      await f.psql(sql)
      await rename(f.state, displaced)
    }),
    schemaRefusal
  )
  assert.equal(
    await readFile(join(displaced, 'schema-bootstrap.json'), 'utf8'),
    journal
  )
  await assert.rejects(readFile(join(displaced, 'schema-version')), {
    code: 'ENOENT'
  })
  await rename(displaced, f.state)
  const recovered = await prepareSchemaBootstrap(f)
  await recovered.inspect(f.psql)
  await recovered.complete(f.psql)
  assert.equal(f.transactions.length, 1)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
})

test('malformed, foreign and incomplete database observations refuse before bootstrap', async (t) => {
  const cases = [
    'not-json',
    JSON.stringify({
      ...{
        database: 'postgres',
        owner: 'desktop_owner',
        receipt: null,
        empty: true
      },
      extra: true
    }),
    JSON.stringify({
      database: 'other',
      owner: 'desktop_owner',
      receipt: null,
      empty: true
    }),
    JSON.stringify({
      database: 'postgres',
      owner: 'other',
      receipt: null,
      empty: true
    }),
    JSON.stringify({
      database: 'postgres',
      owner: 'desktop_owner',
      empty: true
    }),
    JSON.stringify({
      database: 'postgres',
      owner: 'desktop_owner',
      receipt: null,
      empty: 'true'
    }),
    JSON.stringify({
      database: 'postgres',
      owner: 'desktop_owner',
      receipt: 'desktop-macos-schema:' + 'f'.repeat(64),
      empty: false
    }),
    JSON.stringify({
      database: 'postgres',
      owner: 'desktop_owner',
      receipt: 'unrelated database comment',
      empty: true
    }),
    ' '.repeat(4097)
  ]
  for (const [index, observation] of cases.entries())
    await t.test(`observation ${index}`, async (t) => {
      const f = await fixture(t)
      const prepared = await prepareSchemaBootstrap(f)
      await assert.rejects(
        prepared.inspect(async () => observation),
        schemaRefusal
      )
      assert.equal(f.transactions.length, 0)
      assert.equal(
        await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
        journal
      )
      await assert.rejects(readFile(join(f.state, 'schema-version')), {
        code: 'ENOENT'
      })
    })
})

test('unsafe or conflicting private authority files are preserved and refused', async (t) => {
  for (const name of ['schema-version', 'schema-bootstrap.json']) {
    const correct = name === 'schema-version' ? target : journal
    const cases = {
      symlink: async (path, f) => {
        const outside = join(f.schemaDirectory, 'outside')
        await writeFile(outside, correct)
        await symlink(outside, path)
      },
      directory: (path) => mkdir(path, { mode: 0o700 }),
      hardlink: async (path, f) => {
        const outside = join(f.schemaDirectory, 'outside')
        await writeFile(outside, correct, { mode: 0o600 })
        await link(outside, path)
      },
      publicMode: async (path) => {
        await writeFile(path, correct, { mode: 0o600 })
        await chmod(path, 0o644)
      },
      oversized: (path) => writeFile(path, 'x'.repeat(257), { mode: 0o600 }),
      conflicting: (path) =>
        writeFile(
          path,
          name === 'schema-version'
            ? 'f'.repeat(64)
            : journal.replace(target, 'f'.repeat(64)),
          { mode: 0o600 }
        ),
      truncated: (path) =>
        writeFile(path, correct.slice(0, -1), { mode: 0o600 })
    }
    for (const [kind, setup] of Object.entries(cases))
      await t.test(`${name}: ${kind}`, async (t) => {
        const f = await fixture(t)
        await f.pgdata()
        const path = join(f.state, name)
        await setup(path, f)
        const before = await readdir(f.state)
        await assert.rejects(prepareSchemaBootstrap(f), schemaRefusal)
        assert.deepEqual(await readdir(f.state), before)
        assert.equal(f.transactions.length, 0)
      })
  }
})

test('unsupported journal formats and ambiguous JSON never become bootstrap authority', async (t) => {
  for (const bytes of [
    journal.replace('/v1', '/v2'),
    '{}',
    '{',
    journal.replace('"target":', '"target":"' + target + '","target":'),
    journal + '\n'
  ]) {
    const f = await fixture(t)
    await f.pgdata()
    await writeFile(join(f.state, 'schema-bootstrap.json'), bytes, {
      mode: 0o600
    })
    await assert.rejects(prepareSchemaBootstrap(f), schemaRefusal)
    assert.equal(
      await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
      bytes
    )
  }
})

test('nonempty partial pgdata and a marker without its database are not fresh bootstrap', async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.state, 'pgdata'), { mode: 0o700 })
  await writeFile(join(f.state, 'pgdata/unknown'), 'SYNTHETIC-EXISTING-DATA')
  await assert.rejects(prepareSchemaBootstrap(f), schemaRefusal)
  await rm(join(f.state, 'pgdata'), { recursive: true })
  await writeFile(join(f.state, 'schema-version'), target, { mode: 0o600 })
  await assert.rejects(prepareSchemaBootstrap(f), schemaRefusal)
  await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
    code: 'ENOENT'
  })
  const unknown = await fixture(t)
  await unknown.pgdata()
  unknown.database.receipt = initdbComment
  const unattributed = await prepareSchemaBootstrap(unknown)
  await assert.rejects(unattributed.inspect(unknown.psql), schemaRefusal)
  assert.deepEqual(await readdir(unknown.state), ['pgdata'])
})

test('authority files changed after inspection are never replaced or applied', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await prepared.inspect(f.psql)
  const changed = journal.replace(target, 'f'.repeat(64))
  await writeFile(join(f.state, 'schema-bootstrap.json'), changed, {
    mode: 0o600
  })
  await assert.rejects(prepared.complete(f.psql), schemaRefusal)
  assert.equal(f.transactions.length, 0)
  assert.equal(
    await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
    changed
  )
})

test('a matching receipt contradicting an empty database is refused rather than adopted', async (t) => {
  const f = await fixture(t)
  await f.pgdata()
  f.database.receipt = 'desktop-macos-schema:' + target
  const prepared = await prepareSchemaBootstrap(f)
  await assert.rejects(prepared.inspect(f.psql), schemaRefusal)
  await assert.rejects(readFile(join(f.state, 'schema-version')), {
    code: 'ENOENT'
  })
})

test('an unavailable or indirect state directory reports only the fixed schema refusal', async (t) => {
  for (const kind of ['missing', 'symlink', 'publicMode'])
    await t.test(kind, async (t) => {
      const f = await fixture(t)
      if (kind === 'publicMode') await chmod(f.state, 0o755)
      else {
        const displaced = f.state + '-displaced'
        await rename(f.state, displaced)
        if (kind === 'symlink') await symlink(displaced, f.state)
      }
      await assert.rejects(prepareSchemaBootstrap(f), schemaRefusal)
    })
})

test(
  'named pipes cannot block or impersonate a private bootstrap authority file',
  { timeout: 2000 },
  async (t) => {
    for (const name of ['schema-version', 'schema-bootstrap.json']) {
      const f = await fixture(t)
      await f.pgdata()
      execFileSync('mkfifo', ['-m', '600', join(f.state, name)], {
        timeout: 1000
      })
      await assert.rejects(prepareSchemaBootstrap(f), schemaRefusal)
    }
  }
)

test('missing, empty, NUL-containing and oversized SQL never create bootstrap authority', async (t) => {
  for (const [kind, bytes] of [
    ['missing', undefined],
    ['empty', ''],
    ['nul', 'SELECT 1;\0'],
    ['oversized', Buffer.alloc(16 * 1024 * 1024 + 1, 0x20)]
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t)
      const path = join(f.schemaDirectory, 'authority.sql')
      if (bytes === undefined) await rm(path)
      else await writeFile(path, bytes)
      await assert.rejects(prepareSchemaBootstrap(f), schemaRefusal)
      assert.deepEqual(await readdir(f.state), [])
    })
})

test('directory replacement cannot transfer bootstrap or recovery authority to another workspace', async (t) => {
  for (const mode of ['bootstrap', 'receipt', 'legacy']) {
    for (const phase of [
      'before-inspect',
      'during-inspect',
      'before-complete',
      'during-commit'
    ]) {
      if (phase === 'during-commit' && mode !== 'bootstrap') continue
      await t.test(`${mode}: ${phase}`, async (t) => {
        const f = await fixture(t)
        const original = f.state + '-original'
        await writeFile(
          join(f.state, 'credentials.json'),
          'SYNTHETIC-OWNER-DATA',
          { mode: 0o600 }
        )
        if (mode !== 'bootstrap') {
          await f.pgdata()
          f.database.empty = false
          if (mode === 'receipt')
            f.database.receipt = 'desktop-macos-schema:' + target
          else
            await writeFile(join(f.state, 'schema-version'), target, {
              mode: 0o600
            })
        }
        const prepared = await prepareSchemaBootstrap(f)
        if (mode === 'bootstrap') await f.pgdata()
        const names = (await readdir(f.state)).sort()
        const replace = async () => {
          await rename(f.state, original)
          await mkdir(f.state, { mode: 0o700 })
        }
        if (phase === 'before-inspect') {
          await replace()
          await assert.rejects(prepared.inspect(f.psql), schemaRefusal)
        } else if (phase === 'during-inspect') {
          await assert.rejects(
            prepared.inspect(async (sql) => {
              const result = await f.psql(sql)
              await replace()
              return result
            }),
            schemaRefusal
          )
        } else {
          await prepared.inspect(f.psql)
          if (phase === 'before-complete') {
            await replace()
            await assert.rejects(prepared.complete(f.psql), schemaRefusal)
          } else {
            await assert.rejects(
              prepared.complete(async (sql) => {
                await f.psql(sql)
                await replace()
              }),
              schemaRefusal
            )
          }
        }
        assert.deepEqual(
          await readdir(f.state),
          [],
          'replacement remains untouched'
        )
        assert.deepEqual((await readdir(original)).sort(), names)
        assert.equal(
          await readFile(join(original, 'credentials.json'), 'utf8'),
          'SYNTHETIC-OWNER-DATA'
        )
        assert.equal(
          await readFile(join(original, 'pgdata/PG_VERSION'), 'utf8'),
          '18'
        )
        assert.equal(f.transactions.length, phase === 'during-commit' ? 1 : 0)
      })
    }
  }
})

test('a symlink back to a displaced state cannot resume prepared receipt recovery', async (t) => {
  const f = await fixture(t)
  await f.pgdata()
  f.database.receipt = 'desktop-macos-schema:' + target
  f.database.empty = false
  await writeFile(join(f.state, 'credentials.json'), 'SYNTHETIC-OWNER-DATA', {
    mode: 0o600
  })
  const prepared = await prepareSchemaBootstrap(f)
  await prepared.inspect(f.psql)
  const original = f.state + '-original'
  await rename(f.state, original)
  await symlink(original, f.state)
  await assert.rejects(prepared.complete(f.psql), schemaRefusal)
  assert.ok((await lstat(f.state)).isSymbolicLink())
  assert.deepEqual((await readdir(original)).sort(), [
    'credentials.json',
    'pgdata'
  ])
  assert.equal(
    await readFile(join(original, 'credentials.json'), 'utf8'),
    'SYNTHETIC-OWNER-DATA'
  )
  assert.equal(f.transactions.length, 0)
})

// Explicit admission only: this never discovers or connects to a host database.
// The supplied runtime must contain genuine pgcrypto; absence is a test failure.
const postgresBin = process.env.DESKTOP_SCHEMA_TEST_POSTGRES_BIN

test(
  'real PostgreSQL refuses standalone public objects but accepts actual extension membership',
  {
    skip: !postgresBin,
    timeout: 180_000
  },
  async (t) => {
    assert.ok(isAbsolute(postgresBin))
    assert.notEqual(process.getuid(), 0)
    const directory = await lstat(postgresBin)
    assert.ok(directory.isDirectory() && !directory.isSymbolicLink())
    const environment = {
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      PGPASSFILE: '/dev/null',
      PGSERVICEFILE: '/dev/null',
      PGCONNECT_TIMEOUT: '3',
      PGSSLMODE: 'disable'
    }
    const command = (name, args, input) => {
      try {
        return execFileSync(join(postgresBin, name), args, {
          env: environment,
          input,
          encoding: 'utf8',
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
      } catch {
        // Never surface PostgreSQL output, environment or filesystem paths.
        throw new Error('Synthetic PostgreSQL control failed')
      }
    }
    for (const name of ['initdb', 'pg_ctl', 'postgres', 'psql']) {
      const binary = await lstat(join(postgresBin, name))
      assert.ok(binary.isFile() && !binary.isSymbolicLink())
      assert.equal(command(name, ['--version']), `${name} (PostgreSQL) 18.6`)
    }
    const databaseFixture = async (t) => {
      // A short private socket path also works with Darwin's Unix-socket limit.
      const root = await mkdtemp('/tmp/desktop-schema-')
      await chmod(root, 0o700)
      let startAttempted = false
      const data = join(root, 'state', 'pgdata')
      t.after(async () => {
        if (startAttempted)
          command('pg_ctl', [
            '-D',
            data,
            '-m',
            'immediate',
            '-w',
            '-t',
            '15',
            'stop'
          ])
        await rm(root, { recursive: true, force: true })
      })
      const state = join(root, 'state'),
        schemaDirectory = join(root, 'schema'),
        sockets = join(root, 'sockets')
      await mkdir(state, { mode: 0o700 })
      await mkdir(schemaDirectory, { mode: 0o700 })
      await mkdir(sockets, { mode: 0o700 })
      await writeFile(join(schemaDirectory, 'canonical-objects.sql'), canonical)
      await writeFile(join(schemaDirectory, 'authority.sql'), authority)
      const prepared = await prepareSchemaBootstrap({ state, schemaDirectory })
      command('initdb', [
        '-D',
        data,
        '-U',
        'desktop_owner',
        '--auth=trust',
        '--encoding=UTF8',
        '--locale=C'
      ])
      startAttempted = true
      command('pg_ctl', [
        '-D',
        data,
        '-l',
        join(root, 'postgres.log'),
        '-w',
        '-t',
        '15',
        '-o',
        `-k ${sockets} -c listen_addresses=''`,
        'start'
      ])
      const psql = async (sql) =>
        command(
          'psql',
          [
            '-X',
            '-w',
            '-v',
            'ON_ERROR_STOP=1',
            '-A',
            '-t',
            '-h',
            sockets,
            '-U',
            'desktop_owner',
            '-d',
            'postgres'
          ],
          sql
        )
      return { state, schemaDirectory, prepared, psql }
    }
    const cases = [
      [
        'collation',
        'CREATE COLLATION public.synthetic_collation FROM pg_catalog."C";'
      ],
      [
        'operator',
        'CREATE OPERATOR public.=== (LEFTARG=integer, RIGHTARG=integer, FUNCTION=pg_catalog.int4eq);'
      ],
      [
        'operator family',
        'CREATE OPERATOR FAMILY public.synthetic_family USING btree;'
      ],
      [
        'text search',
        'CREATE TEXT SEARCH CONFIGURATION public.synthetic_search (COPY=pg_catalog.simple);'
      ],
      [
        'default privileges',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;'
      ]
    ]
    for (const [name, sql] of cases)
      await t.test(name, async (t) => {
        const f = await databaseFixture(t)
        await f.psql(sql)
        await assert.rejects(f.prepared.inspect(f.psql), schemaRefusal)
        assert.equal(
          await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
          journal
        )
        await assert.rejects(readFile(join(f.state, 'schema-version')), {
          code: 'ENOENT'
        })
      })
    await t.test(
      'an object created after inspection still prevents transactional replay',
      async (t) => {
        const f = await databaseFixture(t)
        await f.prepared.inspect(f.psql)
        await f.psql(cases[0][1])
        await assert.rejects(f.prepared.complete(f.psql), schemaRefusal)
        assert.equal(
          await f.psql("SELECT to_regtype('public.app_role') IS NULL;"),
          't'
        )
        assert.equal(
          await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
          journal
        )
        await assert.rejects(readFile(join(f.state, 'schema-version')), {
          code: 'ENOENT'
        })
      }
    )
    await t.test(
      'pgcrypto does not hide an unrelated public object',
      async (t) => {
        const f = await databaseFixture(t)
        await f.psql('CREATE EXTENSION pgcrypto WITH SCHEMA public;')
        await f.psql(cases[0][1])
        await assert.rejects(f.prepared.inspect(f.psql), schemaRefusal)
        await assert.rejects(readFile(join(f.state, 'schema-version')), {
          code: 'ENOENT'
        })
      }
    )
    await t.test(
      'genuine pgcrypto members allow fresh bootstrap and receipt recovery',
      async (t) => {
        const f = await databaseFixture(t)
        assert.equal(
          await f.psql(
            "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"
          ),
          initdbComment
        )
        await f.psql('CREATE EXTENSION pgcrypto WITH SCHEMA public;')
        assert.equal(
          await f.psql(
            "SELECT encode(public.digest('synthetic', 'sha256'), 'hex')='b3cc0475bb78a5026098858e9889acf666d31062d513d303314eca31d36e72f2';"
          ),
          't'
        )
        await f.prepared.inspect(f.psql)
        await f.prepared.complete(f.psql)
        assert.equal(
          await readFile(join(f.state, 'schema-version'), 'utf8'),
          target
        )
        assert.equal(
          await f.psql(
            "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"
          ),
          'desktop-macos-schema:' + target
        )
        await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
          code: 'ENOENT'
        })
        await rm(join(f.state, 'schema-version'))
        const recovered = await prepareSchemaBootstrap(f)
        await recovered.inspect(f.psql)
        await recovered.complete(f.psql)
        assert.equal(
          await readFile(join(f.state, 'schema-version'), 'utf8'),
          target
        )
      }
    )
  }
)
