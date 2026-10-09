import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nodeLaunchFailureCategories,
  nodeLaunchFailureCategory
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
