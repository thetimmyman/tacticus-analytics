import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  rename,
  symlink,
  link,
  lstat,
  readlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareSchemaBootstrap } from '../../../apps/desktop/platform/windows/schema-bootstrap.mjs'

const canonical = "CREATE TYPE public.app_role AS ENUM ('member');"
const authority = 'REVOKE ALL ON SCHEMA public FROM PUBLIC;'
// Worked fixture digest of the two literal SQL files, in their defined order.
const target =
  'f8859dffe2322a3406d882a9fee200250e2be247723adb8d2fe6b95768069f20'
const initdbComment = 'default administrative connection database'
const journal = JSON.stringify({
  format: 'desktop-windows-schema-bootstrap/v1',
  target
})
const refusal = {
  code: 'ESCHEMA',
  message: 'Local schema state is incompatible; activation refused'
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic Windows schema ü '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state'),
    schemaDirectory = join(root, 'schema')
  await mkdir(state)
  await mkdir(schemaDirectory)
  await writeFile(join(schemaDirectory, 'canonical-objects.sql'), canonical)
  await writeFile(join(schemaDirectory, 'authority.sql'), authority)
  const observation = {
    database: 'postgres',
    owner: 'desktop_owner',
    receipt: initdbComment,
    empty: true
  }
  const transactions = []
  const psql = async (sql) => {
    if (sql.startsWith('SELECT json_build_object('))
      return JSON.stringify(observation)
    assert.match(sql, /^BEGIN;[\s\S]*COMMIT;$/)
    assert.equal(observation.empty, true)
    assert.ok(
      observation.receipt === null || observation.receipt === initdbComment
    )
    assert.ok(sql.includes(canonical + '\n' + authority))
    assert.ok(sql.includes("'desktop-schema:" + target + "'"))
    transactions.push(sql)
    observation.receipt = 'desktop-schema:' + target
    observation.empty = false
  }
  const pgdata = async () => {
    await mkdir(join(state, 'pgdata'))
    await writeFile(join(state, 'pgdata/PG_VERSION'), '18\n')
  }
  return {
    root,
    state,
    schemaDirectory,
    observation,
    transactions,
    psql,
    pgdata
  }
}

test('pre-SQL interruption resumes its exact journal and a second open never replays DDL', async (t) => {
  const f = await fixture(t)
  await prepareSchemaBootstrap(f)
  assert.equal(
    await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
    journal
  )
  await f.pgdata()
  const resumed = await prepareSchemaBootstrap(f)
  await resumed.inspect(f.psql)
  await resumed.complete(f.psql)
  assert.equal(f.transactions.length, 1)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
  assert.deepEqual((await readdir(f.state)).sort(), [
    'pgdata',
    'schema-version'
  ])
  const reopened = await prepareSchemaBootstrap(f)
  await reopened.inspect(f.psql)
  await reopened.complete(f.psql)
  assert.equal(f.transactions.length, 1)
})

test('one transaction applies the exact retained SQL even if packaged inputs later change', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await writeFile(join(f.schemaDirectory, 'authority.sql'), 'SELECT 42;')
  await f.pgdata()
  await prepared.inspect(f.psql)
  await prepared.complete(f.psql)
  assert.equal(f.transactions.length, 1)
  assert.equal(f.transactions[0].includes('SELECT 42;'), false)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
})

test('a missing completion marker recovers the exact committed receipt without DDL', async (t) => {
  for (const pending of [false, true])
    await t.test(`journal=${pending}`, async (t) => {
      const f = await fixture(t)
      await f.pgdata()
      if (pending)
        await writeFile(join(f.state, 'schema-bootstrap.json'), journal)
      f.observation.receipt = 'desktop-schema:' + target
      f.observation.empty = false
      const preserved = Buffer.from('synthetic private material')
      await writeFile(join(f.state, 'credentials.json'), preserved)
      await writeFile(join(f.state, 'pgdata/synthetic-rows'), preserved)
      const recovery = await prepareSchemaBootstrap(f)
      await recovery.inspect(f.psql)
      await recovery.complete(f.psql)
      assert.equal(f.transactions.length, 0)
      assert.equal(
        await readFile(join(f.state, 'schema-version'), 'utf8'),
        target
      )
      await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
        code: 'ENOENT'
      })
      assert.deepEqual(
        await readFile(join(f.state, 'credentials.json')),
        preserved
      )
      assert.deepEqual(
        await readFile(join(f.state, 'pgdata/synthetic-rows')),
        preserved
      )
    })
})

test('a committed marker plus unfinished journal retires only the journal', async (t) => {
  const f = await fixture(t)
  await f.pgdata()
  await writeFile(join(f.state, 'schema-version'), target)
  await writeFile(join(f.state, 'schema-bootstrap.json'), journal)
  f.observation.receipt = 'desktop-schema:' + target
  f.observation.empty = false
  const prepared = await prepareSchemaBootstrap(f)
  await prepared.inspect(f.psql)
  await prepared.complete(f.psql)
  assert.equal(f.transactions.length, 0)
  assert.deepEqual((await readdir(f.state)).sort(), [
    'pgdata',
    'schema-version'
  ])
})

test('a legacy exact marker opens without adopting a receipt or replaying SQL', async (t) => {
  for (const receipt of [null, initdbComment])
    await t.test(
      `comment=${receipt === null ? 'absent' : 'initdb'}`,
      async (t) => {
        const f = await fixture(t)
        await f.pgdata()
        await writeFile(join(f.state, 'schema-version'), target)
        f.observation.receipt = receipt
        f.observation.empty = false
        const prepared = await prepareSchemaBootstrap(f)
        await prepared.inspect(f.psql)
        await prepared.complete(f.psql)
        assert.equal(f.transactions.length, 0)
        assert.equal(f.observation.receipt, receipt)
        assert.equal(
          await readFile(join(f.state, 'schema-version'), 'utf8'),
          target
        )
        await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
          code: 'ENOENT'
        })
      }
    )
})

test('a rollback preserves intent and a later open can apply the transaction', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await f.pgdata()
  await prepared.inspect(f.psql)
  await assert.rejects(
    prepared.complete(async () => {
      throw Error('synthetic SQL body must not escape')
    }),
    refusal
  )
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

test('commit acknowledgement loss resumes from the database receipt without replay', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await f.pgdata()
  await prepared.inspect(f.psql)
  await assert.rejects(
    prepared.complete(async (sql) => {
      await f.psql(sql)
      throw Error('synthetic acknowledgement lost')
    }),
    refusal
  )
  assert.equal(f.observation.receipt, 'desktop-schema:' + target)
  await assert.rejects(readFile(join(f.state, 'schema-version')), {
    code: 'ENOENT'
  })
  assert.equal(
    await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
    journal
  )
  const resumed = await prepareSchemaBootstrap(f)
  await resumed.inspect(f.psql)
  await resumed.complete(f.psql)
  assert.equal(f.transactions.length, 1)
})

test('unknown, unattributed and conflicting database states never authorize replay', async (t) => {
  const cases = [
    ['existing empty database without journal', { empty: true }, false, false],
    [
      'existing nonempty database without marker',
      { empty: false },
      false,
      false
    ],
    [
      'unattributed nonempty database with journal',
      { empty: false },
      true,
      false
    ],
    [
      'foreign receipt',
      { receipt: 'synthetic foreign authority', empty: true },
      true,
      false
    ],
    [
      'wrong schema receipt',
      { receipt: 'desktop-schema:' + 'f'.repeat(64), empty: false },
      true,
      false
    ],
    [
      'matching receipt but empty footprint',
      { receipt: 'desktop-schema:' + target, empty: true },
      true,
      false
    ],
    ['legacy marker but empty footprint', { empty: true }, false, true],
    [
      'legacy marker with unfinished intent but no receipt',
      { empty: false },
      true,
      true
    ],
    [
      'legacy marker with foreign receipt',
      { receipt: 'synthetic foreign authority', empty: false },
      false,
      true
    ],
    ['wrong owner', { owner: 'synthetic_other' }, true, false],
    ['wrong database', { database: 'synthetic_other' }, true, false]
  ]
  for (const [name, observation, pending, marked] of cases)
    await t.test(name, async (t) => {
      const f = await fixture(t)
      await f.pgdata()
      if (pending)
        await writeFile(join(f.state, 'schema-bootstrap.json'), journal)
      if (marked) await writeFile(join(f.state, 'schema-version'), target)
      Object.assign(f.observation, observation)
      const before = (await readdir(f.state)).sort()
      const prepared = await prepareSchemaBootstrap(f)
      await assert.rejects(prepared.inspect(f.psql), refusal)
      assert.equal(f.transactions.length, 0)
      assert.deepEqual((await readdir(f.state)).sort(), before)
      if (pending)
        assert.equal(
          await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
          journal
        )
      if (marked)
        assert.equal(
          await readFile(join(f.state, 'schema-version'), 'utf8'),
          target
        )
    })
})

test('malformed database observations and errors expose only the fixed refusal', async (t) => {
  const cases = [
    undefined,
    null,
    '',
    '{}',
    '[]',
    'null',
    '{',
    'x'.repeat(4097),
    JSON.stringify({
      database: 'postgres',
      owner: 'desktop_owner',
      receipt: null,
      empty: 'true'
    }),
    JSON.stringify({
      database: 'postgres',
      owner: 'desktop_owner',
      receipt: null,
      empty: true,
      extra: 'synthetic private data'
    })
  ]
  for (let index = 0; index < cases.length; index++)
    await t.test(`observation ${index}`, async (t) => {
      const f = await fixture(t)
      const prepared = await prepareSchemaBootstrap(f)
      await assert.rejects(
        prepared.inspect(async () => cases[index]),
        refusal
      )
      assert.equal(f.transactions.length, 0)
      assert.equal(
        await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
        journal
      )
    })
  await t.test('database adapter error', async (t) => {
    const f = await fixture(t)
    const prepared = await prepareSchemaBootstrap(f)
    await assert.rejects(
      prepared.inspect(async () => {
        throw Error('synthetic secret SQL result')
      }),
      refusal
    )
  })
})

test('fresh SQL guard rechecks database authority after inspection', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await f.pgdata()
  await prepared.inspect(f.psql)
  f.observation.empty = false
  await assert.rejects(prepared.complete(f.psql), refusal)
  assert.equal(f.transactions.length, 0)
  assert.equal(
    await readFile(join(f.state, 'schema-bootstrap.json'), 'utf8'),
    journal
  )
  await assert.rejects(readFile(join(f.state, 'schema-version')), {
    code: 'ENOENT'
  })
})

test('observed directory replacement refuses before inspection, SQL and marker completion', async (t) => {
  for (const mode of ['bootstrap', 'receipt', 'legacy'])
    for (const boundary of mode === 'bootstrap'
      ? ['before inspect', 'during inspect', 'before complete', 'after SQL']
      : ['before inspect', 'during inspect', 'before complete'])
      await t.test(`${mode}: ${boundary}`, async (t) => {
        const f = await fixture(t)
        if (mode !== 'bootstrap') {
          await f.pgdata()
          f.observation.empty = false
          if (mode === 'receipt')
            f.observation.receipt = 'desktop-schema:' + target
          else await writeFile(join(f.state, 'schema-version'), target)
        }
        const prepared = await prepareSchemaBootstrap(f)
        if (mode === 'bootstrap') await f.pgdata()
        const displaced = join(f.root, 'original-state')
        const replace = async () => {
          await rename(f.state, displaced)
          await mkdir(f.state)
          await writeFile(
            join(f.state, 'replacement-only'),
            'synthetic replacement'
          )
        }
        if (boundary === 'before inspect') {
          await replace()
          let calls = 0
          await assert.rejects(
            prepared.inspect(async () => {
              calls++
              return f.psql('SELECT json_build_object(')
            }),
            refusal
          )
          assert.equal(calls, 0)
        } else if (boundary === 'during inspect') {
          await assert.rejects(
            prepared.inspect(async (sql) => {
              const response = await f.psql(sql)
              await replace()
              return response
            }),
            refusal
          )
        } else {
          await prepared.inspect(f.psql)
          if (boundary === 'before complete' || mode !== 'bootstrap') {
            await replace()
            await assert.rejects(prepared.complete(f.psql), refusal)
          } else {
            await assert.rejects(
              prepared.complete(async (sql) => {
                await f.psql(sql)
                await replace()
              }),
              refusal
            )
          }
        }
        assert.deepEqual(await readdir(f.state), ['replacement-only'])
        assert.equal(
          await readFile(join(f.state, 'replacement-only'), 'utf8'),
          'synthetic replacement'
        )
        if (mode === 'legacy')
          assert.equal(
            await readFile(join(displaced, 'schema-version'), 'utf8'),
            target
          )
        else
          await assert.rejects(readFile(join(displaced, 'schema-version')), {
            code: 'ENOENT'
          })
        if (mode === 'bootstrap')
          assert.equal(
            await readFile(join(displaced, 'schema-bootstrap.json'), 'utf8'),
            journal
          )
        assert.equal(
          f.transactions.length,
          mode === 'bootstrap' && boundary === 'after SQL' ? 1 : 0
        )
      })
})

test('marker or journal changes after preparation refuse without overwriting the conflicting bytes', async (t) => {
  for (const name of ['schema-version', 'schema-bootstrap.json'])
    for (const boundary of ['before inspect', 'before complete', 'after SQL'])
      await t.test(`${name}: ${boundary}`, async (t) => {
        const f = await fixture(t)
        const prepared = await prepareSchemaBootstrap(f)
        await f.pgdata()
        const path = join(f.state, name),
          conflicting = 'synthetic conflicting record'
        if (boundary === 'before inspect') {
          await writeFile(path, conflicting)
          await assert.rejects(prepared.inspect(f.psql), refusal)
        } else {
          await prepared.inspect(f.psql)
          if (boundary === 'before complete') {
            await writeFile(path, conflicting)
            await assert.rejects(prepared.complete(f.psql), refusal)
          } else {
            await assert.rejects(
              prepared.complete(async (sql) => {
                await f.psql(sql)
                await writeFile(path, conflicting)
              }),
              refusal
            )
          }
        }
        assert.equal(await readFile(path, 'utf8'), conflicting)
        assert.equal(f.transactions.length, boundary === 'after SQL' ? 1 : 0)
      })
})

test('mismatched and ambiguous on-disk authority is refused before database access', async (t) => {
  for (const [name, contents] of [
    ['schema-version', 'f'.repeat(64)],
    ['schema-version', target + '\n'],
    ['schema-version', ''],
    ['schema-bootstrap.json', journal + '\n'],
    [
      'schema-bootstrap.json',
      JSON.stringify({ target, format: 'desktop-windows-schema-bootstrap/v1' })
    ],
    [
      'schema-bootstrap.json',
      JSON.stringify({ format: 'desktop-macos-schema-bootstrap/v1', target })
    ],
    [
      'schema-bootstrap.json',
      JSON.stringify({
        format: 'desktop-windows-schema-bootstrap/v1',
        target: 'f'.repeat(64)
      })
    ],
    [
      'schema-bootstrap.json',
      `{"format":"desktop-windows-schema-bootstrap/v1","target":"${target}","target":"${target}"}`
    ]
  ])
    await t.test(`${name} representation ${contents.length}`, async (t) => {
      const f = await fixture(t)
      await f.pgdata()
      await writeFile(join(f.state, name), contents)
      await assert.rejects(prepareSchemaBootstrap(f), refusal)
      assert.equal(await readFile(join(f.state, name), 'utf8'), contents)
      assert.equal(f.transactions.length, 0)
    })
})

test('nonregular, indirect, multiply-linked and oversized authority files are refused intact', async (t) => {
  for (const name of ['schema-version', 'schema-bootstrap.json'])
    for (const kind of ['directory', 'symlink', 'hardlink', 'oversized'])
      await t.test(`${name}: ${kind}`, async (t) => {
        const f = await fixture(t)
        await f.pgdata()
        const path = join(f.state, name)
        const contents = name === 'schema-version' ? target : journal
        const outside = join(f.root, 'outside-record')
        await writeFile(outside, contents)
        if (kind === 'directory') await mkdir(path)
        if (kind === 'symlink') {
          try {
            await symlink(outside, path)
          } catch (error) {
            if (error.code === 'EPERM') {
              t.skip('Host cannot create the symlink fixture')
              return
            }
            throw error
          }
        }
        if (kind === 'hardlink') await link(outside, path)
        if (kind === 'oversized') await writeFile(path, 'x'.repeat(257))
        await assert.rejects(prepareSchemaBootstrap(f), refusal)
        assert.equal(await readFile(outside, 'utf8'), contents)
        assert.equal(f.transactions.length, 0)
      })
})

test('dangling marker and journal links are refused rather than adopted as absent files', async (t) => {
  for (const name of ['schema-version', 'schema-bootstrap.json'])
    await t.test(name, async (t) => {
      const f = await fixture(t)
      const outside = join(f.root, 'absent-target')
      const path = join(f.state, name)
      try {
        await symlink(outside, path)
      } catch (error) {
        if (error.code === 'EPERM') {
          t.skip('Host cannot create the symlink fixture')
          return
        }
        throw error
      }
      await assert.rejects(prepareSchemaBootstrap(f), refusal)
      assert.equal((await lstat(path)).isSymbolicLink(), true)
      assert.equal(await readlink(path), outside)
      assert.deepEqual(await readdir(f.state), [name])
      await assert.rejects(readFile(outside), { code: 'ENOENT' })
      assert.equal(f.transactions.length, 0)
    })
})

test('invalid packaged SQL refuses before creating a bootstrap journal', async (t) => {
  for (const [name, bytes] of [
    ['authority.sql', Buffer.from([0xff])],
    ['authority.sql', Buffer.from('SELECT\0 1;')],
    ['canonical-objects.sql', Buffer.alloc(0)],
    ['canonical-objects.sql', Buffer.alloc(16 * 1024 * 1024 + 1)]
  ])
    await t.test(`${name} size ${bytes.length}`, async (t) => {
      const f = await fixture(t)
      await writeFile(join(f.schemaDirectory, name), bytes)
      await assert.rejects(prepareSchemaBootstrap(f), refusal)
      await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
        code: 'ENOENT'
      })
    })
})

test('missing, nonregular and indirect packaged SQL refuses before bootstrap intent', async (t) => {
  for (const kind of ['missing', 'directory', 'symlink', 'hardlink'])
    await t.test(kind, async (t) => {
      const f = await fixture(t)
      const path = join(f.schemaDirectory, 'authority.sql')
      const outside = join(f.root, 'outside-sql')
      await writeFile(outside, authority)
      await rm(path)
      if (kind === 'directory') await mkdir(path)
      if (kind === 'symlink') {
        try {
          await symlink(outside, path)
        } catch (error) {
          if (error.code === 'EPERM') {
            t.skip('Host cannot create the symlink fixture')
            return
          }
          throw error
        }
      }
      if (kind === 'hardlink') await link(outside, path)
      await assert.rejects(prepareSchemaBootstrap(f), refusal)
      assert.equal(await readFile(outside, 'utf8'), authority)
      await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
        code: 'ENOENT'
      })
    })
})

test('partial or incompatible PostgreSQL data is not mistaken for fresh state', async (t) => {
  for (const kind of [
    'partial',
    '17',
    '18-extra',
    'directory-version',
    'marker-only'
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t)
      if (kind === 'marker-only')
        await writeFile(join(f.state, 'schema-version'), target)
      else {
        await mkdir(join(f.state, 'pgdata'))
        if (kind === 'partial')
          await writeFile(
            join(f.state, 'pgdata/partial'),
            'synthetic partial database'
          )
        else if (kind === 'directory-version')
          await mkdir(join(f.state, 'pgdata/PG_VERSION'))
        else
          await writeFile(
            join(f.state, 'pgdata/PG_VERSION'),
            kind === '17' ? '17\n' : '18\nextra'
          )
      }
      await assert.rejects(prepareSchemaBootstrap(f), refusal)
      await assert.rejects(readFile(join(f.state, 'schema-bootstrap.json')), {
        code: 'ENOENT'
      })
    })
})

test('empty PostgreSQL directory admits fresh intent and CRLF PostgreSQL18 state is supported', async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.state, 'pgdata'))
  const prepared = await prepareSchemaBootstrap(f)
  await writeFile(join(f.state, 'pgdata/PG_VERSION'), '18\r\n')
  await prepared.inspect(f.psql)
  await prepared.complete(f.psql)
  const reopened = await prepareSchemaBootstrap(f)
  await reopened.inspect(f.psql)
  await reopened.complete(f.psql)
  assert.equal(f.transactions.length, 1)
})

test('fresh journaled state also accepts an absent initdb database comment', async (t) => {
  const f = await fixture(t)
  f.observation.receipt = null
  const prepared = await prepareSchemaBootstrap(f)
  await f.pgdata()
  await prepared.inspect(f.psql)
  await prepared.complete(f.psql)
  assert.equal(f.transactions.length, 1)
  assert.equal(f.observation.receipt, 'desktop-schema:' + target)
})

test('unavailable or indirect state directories emit only the fixed refusal', async (t) => {
  for (const kind of ['missing', 'file', 'symlink'])
    await t.test(kind, async (t) => {
      const f = await fixture(t)
      await rm(f.state, { recursive: true })
      if (kind === 'file') await writeFile(f.state, 'synthetic ordinary file')
      if (kind === 'symlink') {
        const outside = join(f.root, 'outside-state')
        await mkdir(outside)
        try {
          await symlink(outside, f.state, 'junction')
        } catch (error) {
          if (error.code === 'EPERM') {
            t.skip('Host cannot create the symlink fixture')
            return
          }
          throw error
        }
      }
      await assert.rejects(prepareSchemaBootstrap(f), refusal)
    })
})

test('completion requires inspected authority and cannot be repeated on one handle', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareSchemaBootstrap(f)
  await assert.rejects(prepared.complete(f.psql), refusal)
  await f.pgdata()
  await prepared.inspect(f.psql)
  await assert.rejects(prepared.inspect(f.psql), refusal)
  await prepared.complete(f.psql)
  await assert.rejects(prepared.complete(f.psql), refusal)
  assert.equal(f.transactions.length, 1)
})
