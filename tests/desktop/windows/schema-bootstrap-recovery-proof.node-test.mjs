import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  rm
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  windowsSchemaProofScalar,
  windowsSchemaRollbackFence,
  windowsSchemaRollbackBackend,
  windowsSchemaRollbackClientFailure,
  windowsSchemaMarkerBlocker,
  windowsSchemaRecoveryProof
} from '../../../apps/desktop/platform/windows/schema-bootstrap-recovery-proof.mjs'
import { completeNativeSchema } from '../../../apps/desktop/platform/windows/services.mjs'
import { prepareSchemaBootstrap } from '../../../apps/desktop/platform/windows/schema-bootstrap.mjs'

const prefix = 'BEGIN;\nCREATE TABLE public.synthetic_bootstrap(id integer);'
const transaction =
  prefix +
  "\nDO $receipt$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L',current_database(),'desktop-schema:synthetic'); END $receipt$;\nCOMMIT;"
const nonce = 'a'.repeat(16)

test('rollback fence keeps exact transaction prefix and places ready name after it without receipt/COMMIT', () => {
  const fence = windowsSchemaRollbackFence(transaction, nonce)
  assert.equal(fence.initialName, 'desktop-bootstrap-' + nonce)
  assert.equal(fence.readyName, fence.initialName + '-ready')
  assert.equal(
    fence.input,
    prefix + `\nSET LOCAL application_name='${fence.readyName}';\n`
  )
  assert.equal(fence.input.includes('DO $receipt$'), false)
  assert.equal(fence.input.includes('COMMIT;'), false)
  for (const [sql, value] of [
    ['', nonce],
    [transaction.slice(1), nonce],
    [transaction + '\n', nonce],
    [transaction.replace('DO $receipt$', 'DO $different$'), nonce],
    [transaction.replace('COMMIT;', transaction), nonce],
    [transaction, "'invalid"],
    [transaction, 'a'.repeat(15)]
  ])
    assert.throws(() => windowsSchemaRollbackFence(sql, value), {
      code: 'ESCHEMAPROOF'
    })
})

test('only one exact post-prefix backend may be terminated; early/foreign/ambiguous rows refuse', () => {
  const fence = windowsSchemaRollbackFence(transaction, nonce)
  const row = {
    pid: 123,
    application_name: fence.readyName,
    usename: 'desktop_owner',
    datname: 'postgres',
    state: 'idle in transaction',
    wait_event: 'ClientRead'
  }
  assert.equal(windowsSchemaRollbackBackend([row], fence), 123)
  assert.equal(windowsSchemaRollbackBackend([], fence), undefined)
  for (const patch of [
    { application_name: fence.initialName },
    { application_name: 'foreign' },
    { usename: 'foreign' },
    { datname: 'foreign' },
    { state: 'active' },
    { wait_event: null }
  ])
    assert.equal(
      windowsSchemaRollbackBackend([{ ...row, ...patch }], fence),
      undefined
    )
  for (const rows of [
    [row, row],
    [{ ...row, pid: 0 }],
    [{ ...row, pid: 2147483648 }],
    [{ ...row, secret: 'SYNTHETIC-SECRET' }]
  ])
    assert.throws(() => windowsSchemaRollbackBackend(rows, fence), {
      code: 'ESCHEMAPROOF'
    })
  assert.throws(
    () =>
      windowsSchemaRollbackBackend([row], {
        readyName: 'foreign',
        initialName: 'foreign'
      }),
    { code: 'ESCHEMAPROOF' }
  )
})

test(
  'a host-only invocation cannot qualify native Windows recovery',
  { skip: process.platform === 'win32' },
  async () => {
    await assert.rejects(
      windowsSchemaRecoveryProof(
        {},
        {
          scenario: 'interrupted-bootstrap',
          evidence: 'unused',
          root: 'unused'
        }
      ),
      { code: 'ESCHEMAPROOF' }
    )
  }
)

function inertClient(t, mode) {
  const client = spawn(
    process.execPath,
    [
      '-e',
      `
    let text='';process.stdin.setEncoding('utf8');
    process.stdin.on('data',s=>{text+=s});
    process.stdin.on('end',()=>{
      if(${JSON.stringify(mode)}==='signal')process.kill(process.pid,'SIGTERM');
      else if(${JSON.stringify(mode)}!=='stall')process.exit(text==='SELECT 1;\\n' ? ${mode === 'zero' ? 0 : 37} : 0);
      else setInterval(()=>{},1000);
    });
  `
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] }
  )
  client.stdin.on('error', () => {})
  const closed = new Promise((accept, reject) => {
    client.once('error', reject)
    client.once('close', (code, signal) => accept({ code, signal }))
  })
  t.after(async () => {
    if (client.exitCode === null && client.signalCode === null) client.kill()
    await closed
  })
  return { client, closed }
}

test('actual inert child remains blocked before wake; fixed wake+EOF observes a nonzero unsignaled close', async (t) => {
  const { client, closed } = inertClient(t, 'nonzero')
  assert.equal(
    await Promise.race([
      closed,
      new Promise((r) => setTimeout(() => r('pending'), 50))
    ]),
    'pending'
  )
  await windowsSchemaRollbackClientFailure(client, closed)
  assert.deepEqual(await closed, { code: 37, signal: null })
})

for (const mode of ['zero', 'signal', 'stall'])
  test(`actual ${mode} child close cannot qualify rollback`, async (t) => {
    const { client, closed } = inertClient(t, mode)
    await assert.rejects(windowsSchemaRollbackClientFailure(client, closed), {
      code: 'ESCHEMAPROOF'
    })
  })

test('EOF-only success is never sufficient evidence of a failed connection', async (t) => {
  const { client, closed } = inertClient(t, 'nonzero')
  client.stdin.end()
  assert.deepEqual(await closed, { code: 0, signal: null })
  await assert.rejects(windowsSchemaRollbackClientFailure(client, closed), {
    code: 'ESCHEMAPROOF'
  })
})

test('scalar removes one Windows or LF record separator, preserves content whitespace and refuses malformed framing', () => {
  for (const value of ['18.6', '18.6\n', '18.6\r\n'])
    assert.equal(windowsSchemaProofScalar(value), '18.6')
  assert.equal(windowsSchemaProofScalar(' retained \r\n'), ' retained ')
  for (const value of [null, 1, '18.6\r', 'a\nb\n', 'a\n\n', 'a\r\nb\r\n'])
    assert.throws(() => windowsSchemaProofScalar(value), {
      code: 'ESCHEMAPROOF'
    })
})

test('completion seam defaults to actual preparation and forwards a trusted hook without replacing psql', async () => {
  const calls = [],
    psql = async (sql) => {
      calls.push(sql)
      return 'actual-result'
    },
    openClient = () => {}
  const preparation = {
    complete: async (query) => query('unchanged product transaction')
  }
  assert.equal(
    await completeNativeSchema(preparation, psql, openClient),
    'actual-result'
  )
  assert.deepEqual(calls, ['unchanged product transaction'])
  const result = await completeNativeSchema(
    preparation,
    psql,
    openClient,
    async (context) => {
      assert.equal(context.preparation, preparation)
      assert.equal(context.psql, psql)
      assert.equal(context.openClient, openClient)
      return context.preparation.complete(context.psql)
    }
  )
  assert.equal(result, 'actual-result')
  assert.equal(calls.length, 2)
  for (const hook of [null, false, {}, 'hook'])
    await assert.rejects(
      completeNativeSchema(preparation, psql, openClient, hook),
      /Invalid schema proof callback/
    )
  await assert.rejects(
    completeNativeSchema(preparation, psql, openClient, () => {
      throw new Error('synthetic-hook-refusal')
    }),
    /synthetic-hook-refusal/
  )
  assert.equal(calls.length, 2)
})

test('real marker obstruction refuses after committed callback and matching receipt later recovers without a second SQL transaction', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic windows commit '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state'),
    schemaDirectory = join(root, 'schema')
  await mkdir(state)
  await mkdir(schemaDirectory)
  await writeFile(
    join(schemaDirectory, 'canonical-objects.sql'),
    'CREATE TABLE public.synthetic_fixture(id integer);'
  )
  await writeFile(
    join(schemaDirectory, 'authority.sql'),
    'REVOKE ALL ON SCHEMA public FROM PUBLIC;'
  )
  const prepared = await prepareSchemaBootstrap({ state, schemaDirectory })
  await mkdir(join(state, 'pgdata'))
  await writeFile(join(state, 'pgdata/PG_VERSION'), '18\n')
  const journal = await readFile(join(state, 'schema-bootstrap.json'), 'utf8'),
    target = JSON.parse(journal).target
  const observation = {
    database: 'postgres',
    owner: 'desktop_owner',
    receipt: 'default administrative connection database',
    empty: true
  }
  let committed = 0,
    retire
  // SQL is an explicit host seam, not PostgreSQL evidence. Filesystem operations
  // and the exported production bootstrap implementation are real.
  const psql = async (sql) => {
    if (sql.startsWith('SELECT json_build_object('))
      return JSON.stringify(observation)
    assert(sql.startsWith('BEGIN;') && sql.endsWith('COMMIT;'))
    committed++
    observation.receipt = 'desktop-schema:' + target
    observation.empty = false
    retire = await windowsSchemaMarkerBlocker(state)
  }
  await prepared.inspect(psql)
  await assert.rejects(prepared.complete(psql), { code: 'ESCHEMA' })
  assert.equal(committed, 1)
  assert.equal(
    await readFile(join(state, 'schema-bootstrap.json'), 'utf8'),
    journal
  )
  await retire()
  const resumed = await prepareSchemaBootstrap({ state, schemaDirectory })
  await resumed.inspect(psql)
  await resumed.complete(psql)
  assert.equal(committed, 1)
  assert.equal(await readFile(join(state, 'schema-version'), 'utf8'), target)
})

test('blocker retirement preserves displaced or nonempty replacement directories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic windows blocker '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const retire = await windowsSchemaMarkerBlocker(root)
  await rename(join(root, 'schema-version'), join(root, 'original'))
  await mkdir(join(root, 'schema-version'))
  await writeFile(join(root, 'schema-version/retained'), 'synthetic')
  await assert.rejects(retire(), { code: 'ESCHEMAPROOF' })
  assert.equal(
    await readFile(join(root, 'schema-version/retained'), 'utf8'),
    'synthetic'
  )
})
