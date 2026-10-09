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
  test(
    `actual ${mode} child close cannot qualify rollback`,
    { skip: mode === 'signal' && process.platform === 'win32' },
    async (t) => {
      const { client, closed } = inertClient(t, mode)
      await assert.rejects(windowsSchemaRollbackClientFailure(client, closed), {
        code: 'ESCHEMAPROOF'
      })
    }
  )

// The Windows self-signal child does not establish the POSIX signal-close
// contract. These unit records test that guard on every platform, separately
// from the actual OS child cases above.
test('reported signaled close records refuse rollback and keep the fixed wake contract', async () => {
  for (const code of [null, 37]) {
    const writes = []
    const client = { stdin: { end: (value) => writes.push(value) } }
    await assert.rejects(
      windowsSchemaRollbackClientFailure(
        client,
        Promise.resolve({ code, signal: 'SIGTERM' })
      ),
      { code: 'ESCHEMAPROOF' }
    )
    assert.deepEqual(writes, ['SELECT 1;\n'])
  }
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

// The complete maintained proof function runs with explicitly inert service and
// native-command stand-ins. These cases establish diagnostic control flow only;
// they execute no PostgreSQL, Windows native owner or packaged application.
async function recoveryFailureFixture(t, failedSubstep, errorMode = 'known') {
  const { runInNewContext } = await import('node:vm')
  const { createHash, randomBytes } = await import('node:crypto')
  const { readdir, lstat, rmdir } = await import('node:fs/promises')
  const {
    nodeLaunchDiagnostic,
    nativeServicesProbeDiagnostic,
    launchCoordinatorDiagnostic,
    captureNativeServicesFailure
  } =
    await import('../../../apps/desktop/platform/windows/launch-diagnostic.mjs')
  const source = await readFile(
    new URL(
      '../../../apps/desktop/platform/windows/schema-bootstrap-recovery-proof.mjs',
      import.meta.url
    ),
    'utf8'
  )
  const imports = source.match(/^import[\s\S]*? from '[^']+'\n/gm)
  assert(imports && [8, 9].includes(imports.length))
  const root = await mkdtemp(
    join(tmpdir(), 'synthetic-windows-recovery-diagnostic-')
  )
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state'),
    schemaDirectory = join(root, 'schema'),
    evidence = join(root, 'proof.json')
  await mkdir(state)
  await mkdir(schemaDirectory)
  await writeFile(join(state, 'ownership.lock'), '')
  await writeFile(
    join(root, 'bundle-manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      platform: 'win-x64',
      sourceSha: 'a'.repeat(40)
    })
  )
  const canonical = 'SELECT synthetic_canonical;',
    authority = 'SELECT synthetic_authority;'
  await writeFile(join(schemaDirectory, 'canonical-objects.sql'), canonical)
  await writeFile(join(schemaDirectory, 'authority.sql'), authority)
  const target = createHash('sha256')
    .update(canonical)
    .update(authority)
    .digest('hex')
  const expectedReceipt = 'desktop-schema:' + target
  let serviceCalls = 0,
    materialCalls = 0,
    initialName,
    dataCalls = 0,
    cleanupCalls = 0
  const syntheticError = () =>
    new Error(
      'synthetic-private-message postgresql://synthetic:synthetic@private.invalid/postgres'
    )
  const secondOpen = failedSubstep.startsWith('second-open-')
  const secondCalls = []
  let accessorCalls = 0
  const nativeCommand = async () => {
    if (serviceCalls === 3) secondCalls.push('credentials')
    materialCalls++
    return {
      owner: ((failedSubstep === 'recovery-credentials' && materialCalls > 1) ||
      (failedSubstep === 'second-open-credentials' && serviceCalls === 3)
        ? 'e'
        : 'a'
      ).repeat(64),
      auth: 'b'.repeat(64),
      rest: 'c'.repeat(64),
      jwt: 'd'.repeat(64)
    }
  }
  const firstPSQL = async (sql) => {
    if (sql.includes('pg_stat_activity'))
      return JSON.stringify([
        {
          pid: 321,
          application_name: initialName + '-ready',
          usename: 'desktop_owner',
          datname: 'postgres',
          state: 'idle in transaction',
          wait_event: 'ClientRead'
        }
      ])
    if (sql.includes('pg_terminate_backend') || sql.includes('to_regclass'))
      return 't\n'
    assert(sql.includes('shobj_description'))
    return 'default administrative connection database\n'
  }
  const psql = async (sql) => {
    if (serviceCalls === 3)
      secondCalls.push(
        sql === 'synthetic-bootstrap-sql'
          ? 'bootstrap'
          : sql.includes('shobj_description')
            ? 'receipt'
            : 'data'
      )
    if (sql === 'synthetic-bootstrap-sql') return ''
    if (sql.includes('shobj_description'))
      return (
        (failedSubstep === 'recovery-receipt' ||
        (failedSubstep === 'second-open-receipt' && serviceCalls === 3)
          ? 'synthetic-wrong-receipt'
          : expectedReceipt) + '\n'
      )
    if (sql === 'SHOW server_version;')
      return (
        (failedSubstep === 'recovery-postgres-version' ? '17.6' : '18.6') + '\n'
      )
    if (sql.startsWith('INSERT INTO')) {
      if (failedSubstep === 'recovery-seed') throw syntheticError()
      return ''
    }
    assert(sql.includes('json_agg'))
    dataCalls++
    if (failedSubstep === 'recovery-seed-data') return 'synthetic-invalid-json'
    const row = JSON.stringify([
      { id: 991701, userId: 'synthetic-bootstrap-player', damageDealt: 123 }
    ])
    return (
      ((failedSubstep === 'recovery-data-conservation' && dataCalls > 1) ||
      (failedSubstep === 'second-open-data-conservation' && serviceCalls === 3)
        ? ' '
        : '') +
      row +
      '\n'
    )
  }
  const nativeServices = async (_config, { completeSchema }) => {
    serviceCalls++
    if (serviceCalls === 3) secondCalls.push('startup')
    if (serviceCalls === 1) {
      await writeFile(
        join(state, 'schema-bootstrap.json'),
        JSON.stringify({
          format: 'desktop-windows-schema-bootstrap/v1',
          target
        })
      )
      try {
        await completeSchema({
          preparation: { complete: (callback) => callback(transaction) },
          psql: firstPSQL,
          openClient: (name) => {
            initialName = name
            return {
              client: {
                stdin: { write() {}, end() {}, destroy() {} },
                exitCode: null,
                signalCode: null
              },
              closed: Promise.resolve({ code: 9, signal: null })
            }
          }
        })
      } catch (error) {
        assert.equal(error.code, 'ESCHEMAPROOF')
        throw Object.assign(
          new Error('Local schema state is incompatible; activation refused'),
          { code: 'ESCHEMA' }
        )
      }
      assert.fail('The original fault-window must refuse')
    }
    if (serviceCalls === 3 && failedSubstep === 'second-open-native-startup') {
      const error = Object.assign(syntheticError(), { code: 'ESESSION' })
      if (errorMode === 'unknown') {
        Object.assign(error, {
          name: 'synthetic-private-name',
          code: 'synthetic-private-code',
          serviceFailureCode: 'synthetic-private-service'
        })
      } else if (errorMode === 'accessors') {
        for (const name of ['name', 'code', 'message', 'serviceFailureCode'])
          Object.defineProperty(error, name, {
            get() {
              accessorCalls++
              throw new Error('synthetic-accessor-must-not-run')
            }
          })
      }
      captureNativeServicesFailure(error, { stage: 'service-material' })
      throw Object.freeze(error)
    }
    if (serviceCalls === 3 && failedSubstep === 'second-open-bootstrap-count') {
      await completeSchema({
        preparation: {
          complete: (callback) => callback('synthetic-bootstrap-sql')
        },
        psql
      })
    }
    if (failedSubstep === 'recovery-native-startup') {
      throw Object.assign(syntheticError(), {
        serviceFailureCode: 'child-launch-failed',
        serviceExecutable: 'psql.exe',
        serviceBootstrapPhase: 'not-applicable'
      })
    }
    if (serviceCalls === 2 && failedSubstep !== 'recovery-bootstrap-count') {
      await completeSchema({
        preparation: {
          complete: (callback) => callback('synthetic-bootstrap-sql')
        },
        psql
      })
    }
    await writeFile(
      join(state, 'schema-version'),
      failedSubstep === 'recovery-marker' ? 'synthetic-wrong-marker' : target
    )
    if (serviceCalls === 2 && failedSubstep !== 'recovery-journal')
      await rm(join(state, 'schema-bootstrap.json'))
    return {
      psql,
      stop: async () => {
        cleanupCalls++
        if (secondOpen) {
          if (serviceCalls === 3) secondCalls.push('stop')
          if (cleanupCalls === 1) return
          throw Object.assign(syntheticError(), {
            code:
              failedSubstep === 'second-open-stack-stop' && cleanupCalls === 2
                ? 'EPIPE'
                : 'EPERM'
          })
        }
        if (failedSubstep !== 'cleanup-without-primary' || cleanupCalls === 3)
          throw syntheticError()
      }
    }
  }
  const body =
    source
      .replace(/^import[\s\S]*? from '[^']+'\n/gm, '')
      .replace(/^export /gm, '') +
    '\nglobalThis.proof = windowsSchemaRecoveryProof;'
  const context = {
    assert,
    createHash,
    randomBytes,
    readFile,
    readdir,
    lstat,
    mkdir,
    rmdir,
    writeFile,
    join,
    release: () => 'synthetic-host',
    delay: async () => {},
    nativeServices,
    nativeCommand,
    nodeLaunchDiagnostic,
    nativeServicesProbeDiagnostic,
    launchCoordinatorDiagnostic,
    process: { platform: 'win32', arch: 'x64', version: 'v22.23.2' },
    Buffer,
    TextDecoder,
    performance,
    setTimeout,
    clearTimeout
  }
  runInNewContext(body, context, {
    filename: 'synthetic-windows-recovery-source.mjs'
  })
  if (failedSubstep === 'cleanup-without-primary') {
    await assert.rejects(
      context.proof(
        { state, schemaDirectory },
        { scenario: 'interrupted-bootstrap', evidence, root }
      ),
      { message: syntheticError().message }
    )
    await assert.rejects(readFile(evidence + '.failure.json'), {
      code: 'ENOENT'
    })
    assert.equal(cleanupCalls, 3)
    assert.equal(serviceCalls, 3)
    // The host-only stand-in's output is not native evidence and is removed
    // with the fixture. A late cleanup failure must still reject the call.
    return
  }
  await assert.rejects(
    context.proof(
      { state, schemaDirectory },
      { scenario: 'interrupted-bootstrap', evidence, root }
    ),
    {
      code: 'ESCHEMAPROOF',
      message: 'Installed Windows schema recovery proof refused'
    }
  )
  const receipt = JSON.parse(await readFile(evidence + '.failure.json', 'utf8'))
  assert.equal(receipt.completed, false)
  assert.equal(receipt.scenario, 'interrupted-bootstrap')
  assert.equal(
    receipt.stage,
    secondOpen ? 'second-open-conservation' : 'same-workspace-recovery'
  )
  assert.equal(receipt.failedSubstep, failedSubstep)
  assert.equal(receipt.schemaTarget, target)
  assert.equal(receipt.sourceSha, 'a'.repeat(40))
  assert(Buffer.byteLength(JSON.stringify(receipt)) <= 4096)
  assert.deepEqual(
    Object.keys(receipt).sort(),
    [
      'schemaVersion',
      'platform',
      'synthetic',
      'completed',
      'scenario',
      'stage',
      'failedSubstep',
      'sourceSha',
      'manifestSha256',
      'schemaTarget',
      ...(secondOpen ? ['failureDiagnostic'] : []),
      ...(failedSubstep === 'recovery-native-startup' ||
      failedSubstep === 'second-open-native-startup'
        ? ['startupDiagnostic']
        : [])
    ].sort()
  )
  assert.equal(
    JSON.stringify(receipt).includes('synthetic-private-message'),
    false
  )
  assert.equal(JSON.stringify(receipt).includes('private.invalid'), false)
  assert.equal(serviceCalls, secondOpen ? 3 : 2)
  if (secondOpen) {
    assert.equal(
      cleanupCalls,
      failedSubstep === 'second-open-stack-stop' ? 3 : 2
    )
    assert.equal(
      receipt.failureDiagnostic.exceptionClass,
      errorMode === 'known' ? 'Error' : 'unavailable'
    )
    assert.equal(
      receipt.failureDiagnostic.errorCode,
      failedSubstep === 'second-open-native-startup'
        ? errorMode === 'known'
          ? 'ESESSION'
          : errorMode === 'accessors'
            ? 'none'
            : 'unavailable'
        : failedSubstep === 'second-open-stack-stop'
          ? 'EPIPE'
          : 'unavailable'
    )
    assert.equal(receipt.failureDiagnostic.serviceFailureCode, 'unavailable')
    assert.equal(JSON.stringify(receipt).includes('EPERM'), false)
    if (failedSubstep === 'second-open-native-startup') {
      assert.equal(receipt.startupDiagnostic.stage, 'services-start')
      assert.equal(
        receipt.startupDiagnostic.nativeServicesDiagnostic.stage,
        'service-material'
      )
      assert.equal(
        receipt.startupDiagnostic.nativeServicesDiagnostic.errorCode,
        errorMode === 'known'
          ? 'ESESSION'
          : errorMode === 'accessors'
            ? 'none'
            : 'unavailable'
      )
    } else assert.equal(Object.hasOwn(receipt, 'startupDiagnostic'), false)
    const expectedCalls = {
      'second-open-native-startup': ['startup', 'stop'],
      'second-open-bootstrap-count': ['startup', 'bootstrap', 'stop'],
      'second-open-data-conservation': ['startup', 'data', 'stop'],
      'second-open-credentials': ['startup', 'data', 'credentials', 'stop'],
      'second-open-receipt': [
        'startup',
        'data',
        'credentials',
        'receipt',
        'stop'
      ],
      'second-open-stack-stop': [
        'startup',
        'data',
        'credentials',
        'receipt',
        'stop',
        'stop'
      ]
    }
    assert.deepEqual(secondCalls, expectedCalls[failedSubstep])
    assert.equal(accessorCalls, 0)
    for (const text of [
      'synthetic-private-name',
      'synthetic-private-code',
      'synthetic-private-service',
      'synthetic-accessor-must-not-run'
    ])
      assert.equal(JSON.stringify(receipt).includes(text), false)
    await assert.rejects(readFile(evidence), { code: 'ENOENT' })
    return
  }
  assert.equal(
    cleanupCalls,
    failedSubstep === 'recovery-native-startup'
      ? 0
      : failedSubstep === 'recovery-stack-stop'
        ? 2
        : 1
  )
  if (failedSubstep === 'recovery-native-startup') {
    assert.equal(
      receipt.startupDiagnostic.nodeLaunchFailureCategory,
      'service-startup-failed'
    )
    assert.equal(
      receipt.startupDiagnostic.serviceFailureCode,
      'child-launch-failed'
    )
    assert.equal(receipt.startupDiagnostic.serviceExecutable, 'psql.exe')
  } else assert.equal(Object.hasOwn(receipt, 'startupDiagnostic'), false)
  await assert.rejects(readFile(evidence), { code: 'ENOENT' })
}

for (const failedSubstep of [
  'recovery-native-startup',
  'recovery-bootstrap-count',
  'recovery-receipt',
  'recovery-marker',
  'recovery-journal',
  'recovery-credentials',
  'recovery-postgres-version',
  'recovery-seed',
  'recovery-seed-data',
  'recovery-data-conservation',
  'recovery-stack-stop'
]) {
  test(`maintained recovery function retains ${failedSubstep} before cleanup failure without raw errors`, async (t) => {
    await recoveryFailureFixture(t, failedSubstep)
  })
}

test('maintained proof does not hide cleanup failure when no earlier failure exists', async (t) => {
  await recoveryFailureFixture(t, 'cleanup-without-primary')
})

for (const failedSubstep of [
  'second-open-native-startup',
  'second-open-bootstrap-count',
  'second-open-data-conservation',
  'second-open-credentials',
  'second-open-receipt',
  'second-open-stack-stop'
]) {
  test(`maintained second-open function retains ${failedSubstep} before cleanup with no raw errors`, async (t) => {
    await recoveryFailureFixture(t, failedSubstep)
  })
}

for (const mode of ['unknown', 'accessors']) {
  test(`maintained second-open startup diagnostics refuse ${mode} error properties without evaluation or raw output`, async (t) => {
    await recoveryFailureFixture(t, 'second-open-native-startup', mode)
  })
}
