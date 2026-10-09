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
