import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const refusal = {
  code: 'ESCHEMA',
  message: 'Local schema state is incompatible; activation refused'
}
const schema = '8'.repeat(64)

// Copy the unchanged public journey into an isolated package. Only its native
// service boundary is replaced; no database or child process runs in this test.
async function fixture(t, incompatible = refusal) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic Windows recovery '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state')
  await mkdir(join(state, 'pgdata'), { recursive: true })
  await writeFile(join(state, 'schema-version'), schema)
  const rows = [
    { id: 1, userId: 'synthetic-player-a' },
    { id: 2, userId: 'synthetic-player-b' },
    { id: 3, userId: 'synthetic-player-c' },
    { id: 4, userId: 'synthetic-player-d' },
    { id: 5, userId: 'synthetic-player-a' },
    { id: 6, userId: 'synthetic-player-b' },
    { id: 7, userId: 'synthetic-player-c' },
    { id: 8, userId: 'synthetic-player-d' }
  ]
  await writeFile(join(state, 'pgdata', 'synthetic-rows'), JSON.stringify(rows))
  await writeFile(
    join(root, 'recovery.mjs'),
    await readFile(
      new URL(
        '../../../apps/desktop/platform/windows/recovery.mjs',
        import.meta.url
      )
    )
  )
  await writeFile(
    join(root, 'launch-diagnostic.mjs'),
    await readFile(
      new URL(
        '../../../apps/desktop/platform/windows/launch-diagnostic.mjs',
        import.meta.url
      )
    )
  )
  await writeFile(
    join(root, 'services.mjs'),
    `import { EventEmitter } from 'node:events'
import { captureNativeServicesFailure } from './launch-diagnostic.mjs'
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
export async function nativeServices(config) {
  config.starts = (config.starts ?? 0) + 1
  if (config.starts === config.failOnStart) {
    captureNativeServicesFailure(config.startError, { stage: 'auth-readiness' })
    throw config.startError
  }
  const marker = await readFile(join(config.state, 'schema-version'), 'utf8')
    .catch(error => { if (error.code === 'ENOENT') return null; throw error })
  config.calls.push(marker)
  if (marker === 'incompatible' && config.incompatible !== null) {
    if (config.blockMarkerRestore) {
      await rm(join(config.state, 'schema-version'))
      await mkdir(join(config.state, 'schema-version'))
    }
    throw Object.assign(new Error(config.incompatible.message), { code: config.incompatible.code })
  }
  if (marker === null)
    await writeFile(join(config.state, 'schema-version'), config.schema)
  const child = new EventEmitter()
  const service = {
    children: [new EventEmitter(), child],
    fault: undefined,
    async stop() {
      config.stops++
      if (config.stops === config.failOnStop) throw config.stopError
    },
    async psql(sql) {
      if (sql.startsWith('BEGIN;')) throw new Error('synthetic SQL rollback')
      if (sql.startsWith('SELECT to_regclass(')) return 't'
      if (sql.startsWith('SELECT jsonb_agg('))
        return readFile(join(config.state, 'pgdata', 'synthetic-rows'), 'utf8')
      throw new Error('Unexpected synthetic SQL')
    }
  }
  child.kill = () => {
    service.fault = new Error('synthetic Auth stop')
    queueMicrotask(() => child.emit('exit'))
    return true
  }
  return service
}
`
  )
  const config = { state, schema, incompatible, calls: [], stops: 0 }
  const { nativeServices } = await import(
    pathToFileURL(join(root, 'services.mjs')).href
  )
  const { recoveryJourney } = await import(
    pathToFileURL(join(root, 'recovery.mjs')).href
  )
  const diagnostics = await import(
    pathToFileURL(join(root, 'launch-diagnostic.mjs')).href
  )
  const initial = await nativeServices(config)
  const evidencePath = join(root, 'evidence.json')
  return {
    state,
    rows,
    config,
    initial,
    recoveryJourney,
    evidencePath,
    diagnostics
  }
}

test('exact schema refusal permits all later recovery controls and restores the marker', async (t) => {
  const f = await fixture(t)
  await f.recoveryJourney(f.initial, f.config, f.evidencePath)
  assert.deepEqual(JSON.parse(await readFile(f.evidencePath, 'utf8')).checks, [
    'failed-sql-transaction-retains-canonical-data',
    'actual-auth-crash-stops-stack-and-restart-retains-rows',
    'incompatible-schema-refused-before-service-start',
    'lost-schema-marker-restored-without-rebootstrap',
    'stopped-database-checkpoint-and-same-workspace-restore'
  ])
  assert.deepEqual(f.config.calls, [
    schema,
    schema,
    'incompatible',
    null,
    schema
  ])
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), schema)
  assert.deepEqual(
    JSON.parse(
      await readFile(join(f.state, 'pgdata', 'synthetic-rows'), 'utf8')
    ),
    f.rows
  )
  assert.ok(f.config.stops >= 4)
})

for (const [name, incompatible] of [
  ['wrong code', { ...refusal, code: 'EOTHER' }],
  ['wrong message', { ...refusal, message: 'A different refusal' }],
  [
    'message substring',
    { ...refusal, message: `prefix ${refusal.message} suffix` }
  ],
  ['legacy message', { ...refusal, message: 'Incompatible local schema' }],
  ['resolved call', null]
]) {
  test(`${name} cannot qualify recovery and still restores the marker`, async (t) => {
    const f = await fixture(t, incompatible)
    await assert.rejects(
      f.recoveryJourney(f.initial, f.config, f.evidencePath),
      { code: 'ERR_ASSERTION' }
    )
    assert.equal(
      await readFile(join(f.state, 'schema-version'), 'utf8'),
      schema
    )
    assert.deepEqual(f.config.calls, [schema, schema, 'incompatible'])
    await assert.rejects(readFile(f.evidencePath), { code: 'ENOENT' })
    await assert.rejects(
      readFile(
        join(
          f.state,
          '.checkpoints',
          'native-proof',
          'pgdata',
          'synthetic-rows'
        )
      ),
      {
        code: 'ENOENT'
      }
    )
    assert.ok(f.config.stops >= 3)
  })
}

const diagnosticKeys = [
  'cleanupErrorCode',
  'cleanupExceptionClass',
  'errorCode',
  'exceptionClass',
  'step'
]
const projected = (f, error) =>
  f.diagnostics.launchCoordinatorDiagnostic(error, 'recovery-journey')
    .recoveryDiagnostic

test('initial snapshot failure retains exact frozen error and original pre-try no-cleanup boundary', async (t) => {
  const f = await fixture(t)
  const error = Object.freeze(
    Object.assign(new TypeError('SYNTHETIC-PRIVATE-CANARY'), { code: 'EACCES' })
  )
  f.initial.psql = async () => {
    throw error
  }
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => e === error
  )
  assert.equal(f.config.stops, 0)
  assert.deepEqual(projected(f, error), {
    step: 'initial-snapshot',
    exceptionClass: 'TypeError',
    errorCode: 'EACCES',
    cleanupExceptionClass: 'not-applicable',
    cleanupErrorCode: 'not-applicable'
  })
  assert.equal(JSON.stringify(projected(f, error)).includes('CANARY'), false)
  await assert.rejects(readFile(f.evidencePath), { code: 'ENOENT' })
})

test('original initial row-count assertion remains fatal and source-localized before cleanup', async (t) => {
  const f = await fixture(t)
  f.initial.psql = async () => '[]'
  let actual
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => {
      actual = e
      return e.code === 'ERR_ASSERTION'
    }
  )
  assert.equal(f.config.stops, 0)
  assert.equal(projected(f, actual)?.step, 'initial-row-count')
  assert.equal(projected(f, actual)?.exceptionClass, 'AssertionError')
  assert.equal(projected(f, actual)?.errorCode, 'ERR_ASSERTION')
})

test('rollback refusal assertion and original finally cleanup remain enforced', async (t) => {
  const f = await fixture(t),
    original = f.initial.psql
  f.initial.psql = (sql) =>
    sql.startsWith('BEGIN;')
      ? Promise.resolve('unexpected success')
      : original(sql)
  let actual
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => {
      actual = e
      return e.code === 'ERR_ASSERTION'
    }
  )
  assert.equal(projected(f, actual)?.step, 'rollback-transaction-rejection')
  assert.equal(f.config.stops, 1)
  assert.deepEqual(f.config.calls, [schema])
  await assert.rejects(readFile(f.evidencePath), { code: 'ENOENT' })
})

test('later native restart failure publishes only its trusted service diagnostic', async (t) => {
  const f = await fixture(t)
  const error = Object.freeze(
    Object.assign(new Error('Auth readiness timed out'), {
      name: 'TimeoutError',
      code: 'ETIMEDOUT'
    })
  )
  f.config.failOnStart = 2
  f.config.startError = error
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => e === error
  )
  const d = projected(f, error)
  assert.ok(d)
  assert.equal(d.step, 'restart-after-auth')
  assert.equal(d.exceptionClass, 'TimeoutError')
  assert.equal(d.errorCode, 'ETIMEDOUT')
  assert.equal(d.nativeServicesDiagnostic.stage, 'auth-readiness')
  assert.equal(
    d.nativeServicesDiagnostic.sourceFailureCode,
    'auth-readiness-timeout'
  )
  assert.equal(f.config.stops, 2)
  assert.deepEqual(f.config.calls, [schema])
  await assert.rejects(readFile(f.evidencePath), { code: 'ENOENT' })
})

test('final cleanup masks the action exactly as before while diagnostic retains first failure', async (t) => {
  const f = await fixture(t),
    original = f.initial.psql
  const primary = Object.freeze(
    Object.assign(new SyntaxError('SYNTHETIC-PRIVATE-QUERY'), { code: 'EPIPE' })
  )
  const cleanup = Object.freeze(
    Object.assign(new RangeError('SYNTHETIC-PRIVATE-CLEANUP'), {
      code: 'EBUSY'
    })
  )
  f.initial.psql = (sql) =>
    sql.startsWith('SELECT to_regclass(')
      ? Promise.reject(primary)
      : original(sql)
  f.config.failOnStop = 1
  f.config.stopError = cleanup
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => e === cleanup
  )
  assert.deepEqual(projected(f, cleanup), {
    step: 'rollback-table-absent',
    exceptionClass: 'SyntaxError',
    errorCode: 'EPIPE',
    cleanupExceptionClass: 'RangeError',
    cleanupErrorCode: 'EBUSY'
  })
  assert.equal(f.config.stops, 1)
  assert.equal(projected(f, primary), undefined)
})

test('schema marker finally restoration preserves first assertion diagnosis and marker-write cleanup behavior', async (t) => {
  const f = await fixture(t, { ...refusal, code: 'EOTHER' })
  let actual
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => {
      actual = e
      return e.code === 'ERR_ASSERTION'
    }
  )
  assert.equal(projected(f, actual)?.step, 'incompatible-schema-refusal')
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), schema)
  assert.equal(f.config.stops, 3)
})

test('schema marker restore failure retains the original refusal assertion diagnosis', async (t) => {
  const f = await fixture(t, { ...refusal, code: 'EOTHER' })
  f.config.blockMarkerRestore = true
  let actual
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => {
      actual = e
      return ['EISDIR', 'EPERM', 'EACCES'].includes(e.code)
    }
  )
  assert.deepEqual(projected(f, actual), {
    step: 'incompatible-schema-refusal',
    exceptionClass: 'AssertionError',
    errorCode: 'ERR_ASSERTION',
    cleanupExceptionClass: 'Error',
    cleanupErrorCode: actual.code
  })
  assert.equal(f.config.stops, 3)
  await assert.rejects(readFile(f.evidencePath), { code: 'ENOENT' })
})

test('ordinary success receipt and success coordinator schema remain exactly unchanged', async (t) => {
  const f = await fixture(t)
  await f.recoveryJourney(f.initial, f.config, f.evidencePath)
  const receipt = JSON.parse(await readFile(f.evidencePath, 'utf8'))
  assert.deepEqual(Object.keys(receipt), [
    'schemaVersion',
    'platform',
    'native',
    'synthetic',
    'checks',
    'identity',
    'freshInstallationIdentityTransfer'
  ])
  assert.equal(receipt.checks.length, 5)
  assert.equal(f.config.stops, 4)
  assert.equal('recoveryDiagnostic' in receipt, false)
  assert.deepEqual(
    f.diagnostics.launchCoordinatorDiagnostic(undefined, 'recovery-journey'),
    { stage: 'recovery-journey', fixtureFailureCode: 'not-applicable' }
  )
})

test('existing success receipt is not promoted when the original final stop fails', async (t) => {
  const f = await fixture(t),
    error = Object.freeze(
      Object.assign(new Error('SYNTHETIC-CLEANUP'), { code: 'EPERM' })
    )
  f.config.failOnStop = 4
  f.config.stopError = error
  await assert.rejects(
    f.recoveryJourney(f.initial, f.config, f.evidencePath),
    (e) => e === error
  )
  assert.equal(projected(f, error)?.step, 'services-stop-final')
  assert.equal(
    JSON.parse(await readFile(f.evidencePath, 'utf8')).checks.length,
    5
  )
  assert.equal(f.config.stops, 4)
})

test('unknown values, copied records and serialized error fields cannot forge trusted recovery evidence', async (t) => {
  const f = await fixture(t)
  const error = Object.freeze({
    name: 'SYNTHETIC-PRIVATE-CLASS',
    code: 'SYNTHETIC-PRIVATE-CODE',
    message: 'SYNTHETIC-PRIVATE-PATH',
    recoveryDiagnostic: { step: 'initial-snapshot' },
    nativeServicesDiagnostic: { stage: 'auth-readiness' }
  })
  assert.equal(projected(f, error), undefined)
  assert.equal(typeof f.diagnostics.captureRecoveryFailure, 'function')
  f.diagnostics.captureRecoveryFailure(error, {
    step: 'SYNTHETIC-PRIVATE-STEP'
  })
  const d = projected(f, error)
  assert.deepEqual(Object.keys(d).sort(), diagnosticKeys)
  assert.deepEqual(d, {
    step: 'step-unavailable',
    exceptionClass: 'unavailable',
    errorCode: 'unavailable',
    cleanupExceptionClass: 'not-applicable',
    cleanupErrorCode: 'not-applicable'
  })
  assert.equal(JSON.stringify(d).includes('SYNTHETIC-PRIVATE'), false)
  assert.equal(projected(f, { ...error }), undefined)
  assert.equal(
    'recoveryDiagnostic' in
      f.diagnostics.launchCoordinatorDiagnostic(error, 'window-exit'),
    false
  )
  f.diagnostics.captureRecoveryFailure(error, { step: 'evidence-write' })
  assert.equal(projected(f, error)?.step, 'step-unavailable')
})

test('class/code accessors and proxies, including prototype proxies, never execute', async (t) => {
  const f = await fixture(t)
  assert.equal(typeof f.diagnostics.captureRecoveryFailure, 'function')
  let calls = 0
  const accessor = Object.create(null)
  for (const name of ['name', 'code', 'message'])
    Object.defineProperty(accessor, name, {
      get() {
        calls++
        throw new Error('CANARY')
      }
    })
  const proxy = new Proxy(
    {},
    {
      get() {
        calls++
        throw new Error('CANARY')
      },
      getOwnPropertyDescriptor() {
        calls++
        throw new Error('CANARY')
      },
      getPrototypeOf() {
        calls++
        throw new Error('CANARY')
      }
    }
  )
  const inherited = Object.create(proxy)
  for (const error of [accessor, proxy, inherited]) {
    assert.equal(
      f.diagnostics.nodeLaunchDiagnostic(error, ['--recovery'])
        .nodeLaunchFailureCategory,
      'recovery-journey-failed'
    )
    f.diagnostics.captureRecoveryFailure(error, { step: 'initial-snapshot' })
    assert.equal(projected(f, error)?.exceptionClass, 'unavailable')
    assert.equal(projected(f, error)?.errorCode, 'none')
  }
  f.diagnostics.captureRecoveryFailure(new Error('CANARY'), proxy)
  assert.equal(calls, 0)
})

test('primitive original failures remain unmodified and no arbitrary value is exported', async (t) => {
  const f = await fixture(t)
  f.initial.psql = async () => {
    throw null
  }
  let caught = false
  try {
    await f.recoveryJourney(f.initial, f.config, f.evidencePath)
  } catch (error) {
    caught = true
    assert.equal(error, null)
  }
  assert.equal(caught, true)
  assert.equal(f.config.stops, 0)
  assert.equal(projected(f, null), undefined)
})
