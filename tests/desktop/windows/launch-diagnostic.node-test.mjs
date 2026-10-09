import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nodeLaunchFailureCategories,
  nodeLaunchFailureCategory,
  nodeLaunchDiagnostic
} from '../../../apps/desktop/platform/windows/launch-diagnostic.mjs'

test('launch diagnostics expose only fixed bounded categories', () => {
  const cases = [
    [
      new Error('Native owner must supply a verified ASCII database path'),
      [],
      'launch-configuration-invalid'
    ],
    [
      new Error('private schema detail'),
      ['--schema-recovery'],
      'schema-recovery-failed'
    ],
    [
      Object.assign(new Error('private schema detail'), { code: 'ESCHEMA' }),
      [],
      'schema-admission-failed'
    ],
    [
      new Error('private recovery detail'),
      ['--recovery'],
      'recovery-journey-failed'
    ],
    [
      new Error('Proof-owned service failed; private output'),
      [],
      'service-startup-failed'
    ],
    [
      Object.assign(new Error('synthetic-private-spawn-path'), {
        serviceFailureCode: 'child-launch-failed'
      }),
      [],
      'service-startup-failed'
    ],
    [
      new Error('The local application stopped during startup'),
      [],
      'application-stopped-during-startup'
    ],
    [
      new Error('Local application health did not become ready'),
      [],
      'application-health-timeout'
    ],
    [
      new Error('Desktop window verification failed; private output'),
      [],
      'window-verification-failed'
    ],
    [
      Object.assign(
        new Error('Windows secure input or vault is unavailable.'),
        {
          code: 'EVAULTLOCKED'
        }
      ),
      [],
      'native-helper-vault-unavailable'
    ],
    [
      Object.assign(
        new Error(
          'Native secure operation unavailable; native-dll-initialization-failed-0xc0000142; exit-3221225794; sensitive output suppressed'
        ),
        { code: 'ENATIVE' }
      ),
      [],
      'native-helper-dll-init-failed'
    ],
    [
      Object.assign(
        new Error(
          'Native secure operation unavailable; native-runtime-load-refused; exit-3221225781; sensitive output suppressed'
        ),
        { code: 'ENATIVE' }
      ),
      [],
      'native-helper-runtime-load-refused'
    ],
    [
      Object.assign(
        new Error(
          'Native secure operation unavailable; native-os-status-1314; exit-1; sensitive output suppressed'
        ),
        { code: 'ENATIVE' }
      ),
      [],
      'native-helper-os-operation-failed'
    ],
    [
      Object.assign(new Error('synthetic-private-value'), { code: 'ENATIVE' }),
      [],
      'native-helper-operation-refused'
    ],
    [
      Object.assign(new Error('private assertion'), { name: 'AssertionError' }),
      [],
      'launch-assertion-failed'
    ],
    [
      new Error('synthetic-private-value=' + 'x'.repeat(10000)),
      [],
      'node-launch-unclassified'
    ]
  ]
  for (const [error, args, expected] of cases) {
    const category = nodeLaunchFailureCategory(error, args)
    assert.equal(category, expected)
    assert.equal(nodeLaunchFailureCategories.includes(category), true)
    assert.equal(category.includes('private'), false)
    assert.ok(category.length <= 40)
  }
})

test('service launch diagnostics publish only allowlisted failure and phase labels', () => {
  assert.deepEqual(nodeLaunchDiagnostic(), {
    nodeLaunchFailureCategory: 'none',
    serviceFailureCode: 'not-applicable',
    serviceBootstrapPhase: 'not-applicable',
    serviceExecutable: 'not-applicable',
    serviceExitCode: null,
    postgresChildStatus: null
  })

  assert.deepEqual(
    nodeLaunchDiagnostic(
      Object.assign(new Error('initdb.exe exited; synthetic-private-path'), {
        serviceFailureCode: 'password-file-read-refused',
        serviceBootstrapPhase: 'bootstrap-script',
        serviceExecutable: 'initdb.exe',
        serviceExitCode: 1,
        postgresChildStatus: null
      })
    ),
    {
      nodeLaunchFailureCategory: 'service-startup-failed',
      serviceFailureCode: 'password-file-read-refused',
      serviceBootstrapPhase: 'bootstrap-script',
      serviceExecutable: 'initdb.exe',
      serviceExitCode: 1,
      postgresChildStatus: null
    }
  )

  for (const error of [
    Object.assign(new Error('Proof-owned service failed; private output'), {
      serviceFailureCode: 'synthetic-private-value',
      serviceBootstrapPhase: 'synthetic-private-phase',
      serviceExecutable: 'synthetic-private.exe',
      serviceExitCode: -1,
      postgresChildStatus: 0x1_0000_0000
    }),
    Object.assign(new Error('initdb.exe exited'), {
      serviceFailureCode: 'postgres-child-status-0xc0000005',
      serviceBootstrapPhase: '../../private',
      serviceExecutable: 'initdb.exe',
      serviceExitCode: 3221225477,
      postgresChildStatus: 3221225477
    })
  ]) {
    assert.deepEqual(nodeLaunchDiagnostic(error), {
      nodeLaunchFailureCategory: 'service-startup-failed',
      serviceFailureCode: 'unavailable',
      serviceBootstrapPhase: 'unavailable',
      serviceExecutable:
        error.serviceExecutable === 'initdb.exe' ? 'initdb.exe' : 'unavailable',
      serviceExitCode: error.serviceExitCode === 3221225477 ? 3221225477 : null,
      postgresChildStatus:
        error.postgresChildStatus === 3221225477 ? 3221225477 : null
    })
  }

  assert.deepEqual(
    nodeLaunchDiagnostic(
      Object.assign(new TypeError('synthetic-private-value'), {
        serviceFailureCode: 'password-file-read-refused',
        serviceBootstrapPhase: 'bootstrap-script'
      })
    ),
    {
      nodeLaunchFailureCategory: 'launch-type-error',
      serviceFailureCode: 'not-applicable',
      serviceBootstrapPhase: 'not-applicable',
      serviceExecutable: 'not-applicable',
      serviceExitCode: null,
      postgresChildStatus: null
    }
  )
})

import { readFile } from 'node:fs/promises'
import * as vm from 'node:vm'
import * as paths from 'node:path'
import * as urls from 'node:url'
import { EventEmitter } from 'node:events'
import * as diagnostics from '../../../apps/desktop/platform/windows/launch-diagnostic.mjs'

const sourceRoot = new URL('../../../', import.meta.url)
const coordinatorRoot = sourceRoot

async function coordinator({
  fixtureError,
  gatewayError,
  serviceError,
  servicesStartError,
  windowCode = 0,
  recoveryError,
  recovery = false
} = {}) {
  const monitor = new Map()
  const writes = []
  const calls = []
  const context = vm.createContext({
    Buffer,
    AbortSignal,
    Error,
    process: {
      argv: [
        'synthetic-node',
        'synthetic-launch',
        '--state',
        '/synthetic-state',
        '--postgres-home',
        '/synthetic-postgres',
        '--verify',
        '/synthetic-verify',
        '--launch-diagnostic',
        '/synthetic-evidence',
        ...(recovery ? ['--recovery', '/synthetic-recovery'] : [])
      ],
      env: {},
      once: (event, callback) => monitor.set(event, callback),
      exit: () => {
        throw new Error('Unexpected process exit in synthetic control')
      }
    },
    fetch: async (url) => ({
      ok: true,
      status: url.endsWith('/api/health')
        ? 200
        : url.includes('/api/') || url.endsWith('/profile/edit')
          ? 501
          : 403,
      json: async () => ({ status: 'healthy' })
    })
  })
  const services = {
    state: '/synthetic-state',
    serviceCredential: 'synthetic-service',
    fault: null,
    psql: async () => '',
    launch: (file, args) => {
      if (!args[0].endsWith('main.cjs')) return { exitCode: null }
      const child = new EventEmitter()
      child.stderr = new EventEmitter()
      queueMicrotask(() => child.emit('exit', windowCode))
      return child
    },
    stop: async () => {
      calls.push('services-stop')
      if (serviceError) throw serviceError
    }
  }
  const bindings = {
    'node:crypto': { randomBytes: () => Buffer.alloc(32) },
    'node:fs/promises': {
      readFile: async () => JSON.stringify({ seedFormerPasswordFixture: true })
    },
    'node:fs': {
      writeFileSync: (file, raw) => {
        writes.push(JSON.parse(raw))
      }
    },
    'node:path': paths,
    'node:url': urls,
    'node:net': {
      createServer: () => ({
        listen: (port, host, cb) => cb(),
        address: () => ({ port: 12345 }),
        close: (cb) => cb()
      })
    },
    'node:timers/promises': {
      setTimeout: async () => {
        throw new Error('Unexpected wait in synthetic control')
      }
    },
    './services.mjs': {
      nativeServices: async () => {
        if (servicesStartError) throw servicesStartError
        return services
      },
      windowFailureDiagnostic: () => 'fixed-window-diagnostic'
    },
    '../../proof/loopback-gateway.mjs': {
      loopbackGateway: async () => ({
        origin: 'http://127.0.0.1:12345',
        setAppPort: () => {},
        stop: async () => {
          calls.push('gateway-stop')
          if (gatewayError) throw gatewayError
        }
      })
    },
    './setup.mjs': { windowsSetup: () => ({}) },
    './session-gate.mjs': {
      currentSessionChannel: () => ({ token: () => '', attach: () => {} })
    },
    'node:assert': { strict: assert },
    './recovery.mjs': {
      recoveryJourney: async () => {
        if (recoveryError) throw recoveryError
      }
    },
    './migration-fixture.mjs': {
      seedFormerPasswordFixture: async () => {
        if (fixtureError) throw fixtureError
      }
    }
  }
  const source = await readFile(
    new URL('apps/desktop/platform/windows/launch.mjs', coordinatorRoot),
    'utf8'
  )
  const diagnosticSource = await readFile(
    new URL(
      'apps/desktop/platform/windows/launch-diagnostic.mjs',
      coordinatorRoot
    ),
    'utf8'
  )
  // Execute the actual coordinator body with only its fixed imported values
  // supplied by this inert fixture. No module loading or native child runs.
  const prefixEnd = source.indexOf('const here =')
  assert.ok(prefixEnd > 0)
  const body = source
    .slice(prefixEnd)
    .replace(
      'import.meta.url',
      "'file:///synthetic/apps/desktop/platform/windows/launch.mjs'"
    )
  const diagnosticValues = new vm.Script(`(() => {
    ${diagnosticSource.replaceAll('export ', '')}
    return { nodeLaunchDiagnostic, launchCoordinatorDiagnostic:
      typeof launchCoordinatorDiagnostic === 'function' ? launchCoordinatorDiagnostic : undefined }
  })()`).runInContext(context)
  Object.assign(
    context,
    bindings['node:crypto'],
    bindings['node:fs/promises'],
    bindings['node:fs'],
    { dirname: paths.dirname, join: paths.join, resolve: paths.resolve },
    { fileURLToPath: urls.fileURLToPath },
    bindings['node:net'],
    { delay: bindings['node:timers/promises'].setTimeout },
    bindings['./services.mjs'],
    bindings['../../proof/loopback-gateway.mjs'],
    bindings['./setup.mjs'],
    bindings['./session-gate.mjs'],
    { assert },
    bindings['./recovery.mjs'],
    bindings['./migration-fixture.mjs'],
    diagnosticValues
  )
  const evaluate = () =>
    new vm.Script(`(async () => { ${body} })()`).runInContext(context)
  let failure
  try {
    await evaluate()
  } catch (error) {
    failure = error
    monitor.get('uncaughtExceptionMonitor')?.(error)
  }
  return { writes, calls, failure }
}

test('coordinator records first fixture stage before cleanup without replacing thrown error', async () => {
  const primary = new Error('Migration fixture local account failed')
  const cleanup = new Error('synthetic-private-cleanup-value')
  const result = await coordinator({
    fixtureError: primary,
    gatewayError: cleanup
  })
  assert.equal(result.failure, cleanup) // Existing finally behavior remains unchanged.
  assert.deepEqual(result.calls, ['gateway-stop'])
  assert.equal(result.writes.length, 1)
  assert.deepEqual(result.writes[0].coordinatorDiagnostic, {
    stage: 'former-password-fixture',
    fixtureFailureCode: 'account-response-refused'
  })
  assert.equal(
    result.writes[0].nodeLaunchFailureCategory,
    'node-launch-unclassified'
  )
  assert.equal(
    JSON.stringify(result.writes).includes('synthetic-private'),
    false
  )
})

test('coordinator publishes cleanup-only stage and retains previous cleanup order', async () => {
  const error = new Error('synthetic-private-cleanup-value')
  const result = await coordinator({ serviceError: error })
  assert.equal(result.failure, error)
  assert.deepEqual(result.calls, ['gateway-stop', 'services-stop'])
  assert.deepEqual(result.writes[0].coordinatorDiagnostic, {
    stage: 'services-stop',
    fixtureFailureCode: 'not-applicable'
  })
})

test('coordinator public window-failure category and first stage survive cleanup', async () => {
  const result = await coordinator({ windowCode: 1 })
  assert.equal(result.writes.length, 1)
  assert.equal(
    result.writes[0].nodeLaunchFailureCategory,
    'window-verification-failed'
  )
  assert.deepEqual(result.writes[0].coordinatorDiagnostic, {
    stage: 'window-result',
    fixtureFailureCode: 'not-applicable'
  })
  assert.deepEqual(result.calls, ['gateway-stop', 'services-stop'])
})

test('coordinator early services failure has closed stage and no cleanup inference', async () => {
  const result = await coordinator({
    servicesStartError: new Error('unknown-private-value')
  })
  assert.deepEqual(result.calls, [])
  assert.deepEqual(result.writes[0].coordinatorDiagnostic, {
    stage: 'services-start',
    fixtureFailureCode: 'not-applicable'
  })
  assert.equal(JSON.stringify(result.writes).includes('unknown-private'), false)
})

test('coordinator recovery failure is recorded before unchanged stop finally', async () => {
  const cleanup = new Error('synthetic-private-cleanup-value')
  const result = await coordinator({
    recovery: true,
    recoveryError: new Error('unknown-private-recovery'),
    serviceError: cleanup
  })
  assert.equal(result.failure, cleanup)
  assert.equal(
    result.writes[0].nodeLaunchFailureCategory,
    'recovery-journey-failed'
  )
  assert.deepEqual(result.writes[0].coordinatorDiagnostic, {
    stage: 'recovery-journey',
    fixtureFailureCode: 'not-applicable'
  })
})

test('coordinator completed success receipt shape remains exactly original', async () => {
  const result = await coordinator()
  assert.equal(result.failure, undefined)
  assert.deepEqual(result.writes, [
    {
      schemaVersion: 1,
      platform: 'win-x64',
      outcome: 'completed',
      ...nodeLaunchDiagnostic()
    }
  ])
})

test('failure projection accepts only exact public fixture messages and closed stages', () => {
  for (const [message, code] of [
    [
      'Migration fixture requires a new empty test workspace',
      'workspace-occupied'
    ],
    ['Migration fixture local account failed', 'account-response-refused'],
    ['Invalid fixture owner', 'owner-shape-refused'],
    ['Invalid synthetic Auth subject', 'subject-shape-refused'],
    ['Invalid synthetic fixture envelope', 'envelope-refused'],
    ['Unexpected synthetic fields', 'fields-refused'],
    ['Invalid synthetic row', 'row-refused'],
    ['Invalid synthetic cluster', 'cluster-refused'],
    ['Invalid fixture identity', 'identity-refused']
  ])
    assert.deepEqual(
      diagnostics.launchCoordinatorDiagnostic(
        new Error(message),
        'former-password-fixture'
      ),
      { stage: 'former-password-fixture', fixtureFailureCode: code }
    )
  for (const message of [
    'unknown-secret-canary',
    'Migration fixture local account failed: /private/secret',
    ' Migration fixture local account failed',
    'Migration fixture local account failed\n'
  ]) {
    const result = diagnostics.launchCoordinatorDiagnostic(
      new Error(message),
      'former-password-fixture'
    )
    assert.equal(result.fixtureFailureCode, 'unavailable')
    assert.equal(JSON.stringify(result).includes(message), false)
  }
  for (const stage of ['unknown-secret-canary', {}, null, undefined]) {
    assert.deepEqual(
      diagnostics.launchCoordinatorDiagnostic(
        new Error('Migration fixture local account failed'),
        stage
      ),
      { stage: 'stage-unavailable', fixtureFailureCode: 'not-applicable' }
    )
  }
})
