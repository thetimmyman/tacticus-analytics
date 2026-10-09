import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { serviceStartupDiagnostic } from '../../../apps/desktop/platform/windows/services.mjs'

function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 3
  })
}

test('startup diagnostics retain known structured error codes without private messages', () => {
  const process = child()
  const diagnostic = serviceStartupDiagnostic(process)
  process.stderr.write(
    '{"code":"PGRST000","details":{"code":"28P01"},"message":"synthetic-private-connection-string"}'
  )
  const observed = diagnostic()
  assert.match(observed, /pgrst-PGRST000/)
  assert.match(observed, /sqlstate-28P01/)
  assert.match(observed, /exit-3/)
  assert.equal(observed.includes('synthetic-private'), false)
})

test('exit-before-final-pipe data is drained before the final diagnostic', async () => {
  const process = child()
  const diagnostic = serviceStartupDiagnostic(process)
  process.emit('exit', 3)
  const final = diagnostic.afterClose()
  const ended = Promise.all([
    new Promise((resolve) => process.stdout.once('end', resolve)),
    new Promise((resolve) => process.stderr.once('end', resolve))
  ])
  process.stdout.end()
  process.stderr.end(
    '{"code":"PGRST002","message":"synthetic-private-late-body"}'
  )
  await ended
  process.emit('close', 3)
  const observed = await final
  assert.match(observed, /pgrst-PGRST002/)
  assert.match(observed, /streamComplete-true/)
  assert.match(observed, /truncated-false/)
  assert.equal(observed.includes('synthetic-private'), false)
})

test('unknown codes and exit three remain unclassified rather than guessed', () => {
  const process = child()
  const diagnostic = serviceStartupDiagnostic(process)
  process.stderr.write(
    '{"code":"PGRST999","details":{"code":"AB123"},"message":"synthetic-private-body"}'
  )
  assert.match(
    diagnostic(),
    /^unclassified-service-failure; exit-3; pgrst-unavailable; sqlstate-unavailable; streamComplete-false; capturedBytes-\d+; truncated-false; sensitive output suppressed$/
  )
})

test('diagnostic prefix is byte bounded and explicitly reports truncation', () => {
  const process = child()
  const diagnostic = serviceStartupDiagnostic(process)
  process.stdout.write('ü'.repeat(4096))
  process.stderr.write(
    '{"code":"PGRST001","message":"synthetic-private-overflow"}'
  )
  assert.equal(
    diagnostic(),
    'unclassified-service-failure; exit-3; pgrst-unavailable; sqlstate-unavailable; streamComplete-false; capturedBytes-8192; truncated-true; sensitive output suppressed'
  )
})

test('a held pipe has a bounded incomplete diagnostic rather than a complete claim', async () => {
  const process = child()
  const diagnostic = serviceStartupDiagnostic(process)
  const observed = await diagnostic.afterClose()
  assert.equal(
    observed,
    'unclassified-service-failure; exit-3; pgrst-unavailable; sqlstate-unavailable; streamComplete-false; capturedBytes-0; truncated-false; sensitive output suppressed'
  )
})

test('closed but unreadable-ended streams remain explicitly incomplete', async () => {
  const process = child()
  const diagnostic = serviceStartupDiagnostic(process)
  process.stdout.destroy()
  process.stderr.destroy()
  process.emit('close', 3)
  assert.match(await diagnostic.afterClose(), /streamComplete-false/)
})

test('real failed process pipes are complete before reporting their safe code', async () => {
  const processChild = spawn(
    process.execPath,
    [
      '-e',
      'process.stderr.write(JSON.stringify({code:"PGRST001",message:"synthetic-private-real-body"}));process.exitCode=3'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  )
  const diagnostic = serviceStartupDiagnostic(processChild)
  await once(processChild, 'exit')
  const observed = await diagnostic.afterClose()
  assert.match(observed, /exit-3; pgrst-PGRST001;/)
  assert.match(observed, /streamComplete-true/)
  assert.equal(observed.includes('synthetic-private'), false)
})

import * as vm from 'node:vm'
import * as crypto from 'node:crypto'
import * as paths from 'node:path'
import { readFile } from 'node:fs/promises'
import * as launchDiagnostics from '../../../apps/desktop/platform/windows/launch-diagnostic.mjs'

// Execute the maintained nativeServices body with inert operating-system and
// service facades. No Windows helper, network listener or database is started.
async function nativeStartup({
  failAt,
  error = new Error('synthetic-private-detail'),
  cleanupError,
  retireError,
  oneProbeFailure,
  fresh = false,
  platform = 'win32',
  corrupt = false,
  invalidConfiguration = false
} = {}) {
  const calls = [],
    children = [],
    sql = new Map()
  let port = 12000
  const observedProbeFailures = new Set()
  const at = (stage) => {
    calls.push(stage)
    if (stage === failAt) throw error
    if (stage === oneProbeFailure && !observedProbeFailures.has(stage)) {
      observedProbeFailures.add(stage)
      throw Object.assign(new TypeError('synthetic-private-once'), {
        code: 'ECONNREFUSED'
      })
    }
  }
  const makeChild = () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      exitCode: null,
      signalCode: null
    })
    child.kill = () => {
      calls.push('child-stop')
      if (cleanupError) throw cleanupError
      child.exitCode = 0
      child.stdout.end()
      child.stderr.end()
      child.emit('exit', 0, null)
      child.emit('close', 0, null)
      return true
    }
    children.push(child)
    return child
  }
  const fixtureFs = {
    unlink: async (p) => {
      at(
        p.endsWith('owner-password')
          ? 'initdb-password-retire'
          : 'command-retire'
      )
      if (p.endsWith('owner-password') && retireError) throw retireError
    }
  }
  const context = vm.createContext({
    Buffer,
    Error,
    Promise,
    console,
    process: {
      platform,
      env: {},
      once: () => at('interrupt-handlers'),
      removeListener: () => {},
      exit: () => {
        throw Error('Unexpected inert exit')
      }
    },
    ...crypto,
    resolve: paths.resolve,
    join: paths.join,
    basename: paths.basename,
    mkdir: async () => at('state-directory'),
    writeFile: async (p, value) => {
      at(
        p.endsWith('owner-password') ? 'initdb-password-write' : 'command-write'
      )
      sql.set(p, value)
    },
    stat: async () => {
      at('postgres-version-check')
      if (fresh)
        throw Object.assign(new Error('synthetic-absent'), { code: 'ENOENT' })
    },
    createServer: () => {
      at('port-allocation')
      return {
        once() {},
        listen(p, h, accept) {
          accept()
        },
        address() {
          return { port: ++port }
        },
        close(accept) {
          accept()
        }
      }
    },
    nativeCommand: async () => {
      at('service-material')
      return {
        owner: corrupt ? 'invalid' : 'a'.repeat(64),
        auth: 'b'.repeat(64),
        rest: 'c'.repeat(64),
        jwt: 'd'.repeat(64)
      }
    },
    prepareSchemaBootstrap: async () => {
      at('schema-preparation')
      return {
        inspect: async () => at('schema-inspect'),
        complete: async () => at('schema-completion')
      }
    },
    spawn: (file) => {
      at(
        file.endsWith('postgres.exe')
          ? 'postgres-launch'
          : file.endsWith('auth.exe')
            ? 'auth-launch'
            : 'postgrest-launch'
      )
      return makeChild()
    },
    fetch: async (url) => {
      at(url.endsWith('/health') ? 'auth-readiness' : 'postgrest-readiness')
      return { ok: true }
    },
    delay: async () => {},
    fixtureFs,
    captureNativeServicesFailure:
      launchDiagnostics.captureNativeServicesFailure,
    nativeServicesProbeDiagnostic:
      launchDiagnostics.nativeServicesProbeDiagnostic
  })
  const source = await readFile(
    new URL(
      '../../../apps/desktop/platform/windows/services.mjs',
      import.meta.url
    ),
    'utf8'
  )
  const start = source.indexOf('export function signedToken')
  assert.ok(start > 0)
  const cell = "const { unlink } = await import('node:fs/promises')"
  assert.equal(source.split(cell).length, 2)
  const body = source
    .slice(start)
    .replaceAll('export ', '')
    .replace(cell, 'const { unlink } = fixtureFs')
  new vm.Script(body).runInContext(context)
  context.run = async (file, args) => {
    if (file.endsWith('psql.exe')) {
      const text = sql.get(args.at(-1)) ?? ''
      if (text === 'SELECT 1;') {
        at('postgres-readiness')
        return '1\n'
      }
      if (text.includes('SELECT count(*) FROM pg_roles')) {
        at('role-inspection')
        return '0\n'
      }
      at(
        text.includes('CREATE ROLE anon')
          ? 'role-bootstrap'
          : 'auth-role-maintenance'
      )
      return ''
    }
    at(
      file.endsWith('initdb.exe')
        ? 'initdb-run'
        : file.endsWith('pg_ctl.exe')
          ? 'pgctl-stop'
          : 'auth-migrate'
    )
    return ''
  }
  let value, failure
  try {
    value = await context.nativeServices(
      invalidConfiguration
        ? undefined
        : {
            state: '/synthetic-state',
            schemaDirectory: '/synthetic-schema',
            binaries: {
              initdb: '/synthetic/initdb.exe',
              postgres: '/synthetic/postgres.exe',
              psql: '/synthetic/psql.exe',
              pgctl: '/synthetic/pg_ctl.exe',
              auth: '/synthetic/auth.exe',
              authCwd: '/synthetic/auth',
              postgrest: '/synthetic/postgrest.exe'
            }
          }
    )
  } catch (error) {
    failure = error
  }
  return { value, failure, calls, children }
}
const nativeDiagnostic = (error) =>
  launchDiagnostics.launchCoordinatorDiagnostic(error, 'services-start')
    .nativeServicesDiagnostic

for (const stage of [
  'state-directory',
  'schema-preparation',
  'interrupt-handlers',
  'service-material',
  'port-allocation',
  'postgres-version-check',
  'initdb-password-write',
  'initdb-run',
  'initdb-password-retire',
  'postgres-launch',
  'schema-inspect',
  'role-inspection',
  'role-bootstrap',
  'auth-role-maintenance',
  'auth-migrate',
  'auth-launch',
  'schema-completion',
  'postgrest-launch'
])
  test(
    'actual nativeServices failure discloses only closed substage: ' + stage,
    async () => {
      const error = Object.assign(new Error('synthetic-private-detail'), {
        code: 'EACCES'
      })
      const result = await nativeStartup({
        failAt: stage,
        error,
        fresh: stage.startsWith('initdb-')
      })
      assert.equal(result.failure, error)
      const observed = nativeDiagnostic(result.failure)
      assert.equal(observed?.stage, stage)
      assert.equal(observed.exceptionClass, 'Error')
      assert.equal(observed.errorCode, 'EACCES')
      assert.equal(observed.sourceFailureCode, 'unavailable')
      assert.equal(
        JSON.stringify(observed).includes('synthetic-private'),
        false
      )
      assert.equal(observed.cleanupExceptionClass, 'not-applicable')
    }
  )

test('native platform guard and corrupt credential refusal have fixed source-owned labels', async () => {
  const platform = await nativeStartup({ platform: 'linux' })
  assert.equal(nativeDiagnostic(platform.failure)?.stage, 'platform-admission')
  assert.equal(
    nativeDiagnostic(platform.failure).sourceFailureCode,
    'windows-owner-required'
  )
  assert.deepEqual(platform.calls, [])
  const corrupt = await nativeStartup({ corrupt: true })
  assert.equal(nativeDiagnostic(corrupt.failure)?.stage, 'credentials-check')
  assert.equal(
    nativeDiagnostic(corrupt.failure).sourceFailureCode,
    'credentials-corrupt'
  )
})

for (const stage of [
  'postgres-readiness',
  'auth-readiness',
  'postgrest-readiness'
])
  test(
    'actual bounded readiness timeout retains last finite probe classification: ' +
      stage,
    async () => {
      const probe = Object.assign(new TypeError('synthetic-private-probe'), {
        code: 'ECONNREFUSED',
        serviceFailureCode: 'database-authentication-refused'
      })
      const result = await nativeStartup({ failAt: stage, error: probe })
      const observed = nativeDiagnostic(result.failure)
      assert.equal(observed?.stage, stage)
      assert.equal(observed.probeExceptionClass, 'TypeError')
      assert.equal(observed.probeErrorCode, 'ECONNREFUSED')
      assert.equal(
        observed.probeServiceFailureCode,
        'database-authentication-refused'
      )
      assert.equal(observed.sourceFailureCode, stage + '-timeout')
      assert.equal(result.calls.filter((x) => x === stage).length, 100)
      assert.equal(
        JSON.stringify(observed).includes('synthetic-private'),
        false
      )
    }
  )

test('first startup refusal remains classified when unchanged cleanup masks its thrown object', async () => {
  const primary = Object.assign(new Error('synthetic-private-first'), {
    code: 'ESESSION'
  })
  const cleanup = Object.assign(new RangeError('synthetic-private-cleanup'), {
    code: 'EPERM'
  })
  const result = await nativeStartup({
    failAt: 'schema-inspect',
    error: primary,
    cleanupError: cleanup
  })
  assert.equal(result.failure, cleanup) // Preserve the existing thrown cleanup error.
  const observed = nativeDiagnostic(result.failure)
  assert.equal(observed?.stage, 'schema-inspect')
  assert.equal(observed.exceptionClass, 'Error')
  assert.equal(observed.errorCode, 'ESESSION')
  assert.equal(observed.cleanupExceptionClass, 'RangeError')
  assert.equal(observed.cleanupErrorCode, 'EPERM')
  assert.equal(JSON.stringify(observed).includes('synthetic-private'), false)
})

test('successful startup remains the original service shape and produces no failure metadata', async () => {
  const result = await nativeStartup()
  assert.equal(result.failure, undefined)
  assert.deepEqual(
    Object.keys(result.value).sort(),
    [
      'state',
      'ports',
      'token',
      'serviceCredential',
      'validOwnerSession',
      'psql',
      'launch',
      'children',
      'stop',
      'fresh',
      'fault'
    ].sort()
  )
  await result.value.stop()
  assert.equal(result.children.length, 3)
  assert.equal(
    result.children.every((c) => c.exitCode === 0),
    true
  )
  assert.deepEqual(
    launchDiagnostics.launchCoordinatorDiagnostic(undefined, 'services-start'),
    { stage: 'services-start', fixtureFailureCode: 'not-applicable' }
  )
})

test('configuration failure preserves the original TypeError without operating-system calls', async () => {
  const result = await nativeStartup({ invalidConfiguration: true })
  assert.equal(result.failure.name, 'TypeError')
  assert.equal(nativeDiagnostic(result.failure)?.stage, 'configuration')
  assert.equal(nativeDiagnostic(result.failure).exceptionClass, 'TypeError')
  assert.deepEqual(result.calls, [])
})

test('initdb primary failure remains classified across original password-retirement masking', async () => {
  const primary = Object.assign(new Error('synthetic-private-primary'), {
    code: 'EACCES'
  })
  const retire = Object.assign(new Error('synthetic-private-retire'), {
    code: 'EPERM'
  })
  const result = await nativeStartup({
    failAt: 'initdb-run',
    error: primary,
    retireError: retire,
    fresh: true
  })
  assert.equal(result.failure, retire)
  const observed = nativeDiagnostic(result.failure)
  assert.equal(observed?.stage, 'initdb-run')
  assert.equal(observed.errorCode, 'EACCES')
  assert.equal(observed.cleanupErrorCode, 'EPERM')
})

test('readiness clears a recovered transient probe before a later failure', async () => {
  const result = await nativeStartup({
    oneProbeFailure: 'auth-readiness',
    failAt: 'schema-completion'
  })
  assert.equal(result.calls.filter((x) => x === 'auth-readiness').length, 2)
  const observed = nativeDiagnostic(result.failure)
  assert.equal(observed?.stage, 'schema-completion')
  assert.equal(observed.probeExceptionClass, 'not-applicable')
  assert.equal(observed.probeErrorCode, 'not-applicable')
})

test('a frozen native error retains exact identity and no diagnostic mutation', async () => {
  const error = Object.freeze(
    Object.assign(new Error('synthetic-private-frozen'), { code: 'EUPSTREAM' })
  )
  const keys = Object.getOwnPropertyNames(error)
  const result = await nativeStartup({ failAt: 'service-material', error })
  assert.equal(result.failure, error)
  assert.deepEqual(Object.getOwnPropertyNames(error), keys)
  assert.equal(nativeDiagnostic(result.failure)?.errorCode, 'EUPSTREAM')
})

test('diagnostic accessors never execute and unknown names/codes/probe labels remain closed', () => {
  let accesses = 0
  const error = {}
  for (const key of ['message', 'name', 'code'])
    Object.defineProperty(error, key, {
      get() {
        accesses++
        throw Error('synthetic-private-getter')
      }
    })
  launchDiagnostics.captureNativeServicesFailure(error, {
    stage: 'synthetic-private-stage',
    probe: {
      exceptionClass: 'synthetic-private-name',
      errorCode: 'synthetic-private-code',
      serviceFailureCode: 'synthetic-private-service'
    }
  })
  assert.deepEqual(nativeDiagnostic(error), {
    stage: 'stage-unavailable',
    exceptionClass: 'unavailable',
    errorCode: 'none',
    sourceFailureCode: 'unavailable',
    probeExceptionClass: 'unavailable',
    probeErrorCode: 'unavailable',
    probeServiceFailureCode: 'unavailable',
    cleanupExceptionClass: 'not-applicable',
    cleanupErrorCode: 'not-applicable'
  })
  assert.equal(accesses, 0)
  assert.equal(
    JSON.stringify(nativeDiagnostic(error)).includes('synthetic-private'),
    false
  )
})

test('service-start metadata is unavailable on unrelated coordinator stages and has exactly nine fields', async () => {
  const result = await nativeStartup({ failAt: 'service-material' })
  assert.deepEqual(
    Object.keys(nativeDiagnostic(result.failure)).sort(),
    [
      'stage',
      'exceptionClass',
      'errorCode',
      'sourceFailureCode',
      'probeExceptionClass',
      'probeErrorCode',
      'probeServiceFailureCode',
      'cleanupExceptionClass',
      'cleanupErrorCode'
    ].sort()
  )
  assert.deepEqual(
    launchDiagnostics.launchCoordinatorDiagnostic(
      result.failure,
      'services-stop'
    ),
    { stage: 'services-stop', fixtureFailureCode: 'not-applicable' }
  )
  assert.equal(
    JSON.stringify(nativeDiagnostic(result.failure)).includes(
      'synthetic-private'
    ),
    false
  )
})
