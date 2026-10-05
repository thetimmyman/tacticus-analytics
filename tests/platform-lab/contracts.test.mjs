import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateFixture,
  assertNoCanaries,
  fixtureServer
} from '../../apps/platform-lab/fixtures.mjs'
import {
  validateEvidence,
  validateFixture,
  qualifiesPhysicalMobile
} from '../../apps/platform-lab/contracts/validate.mjs'

export function evidence(overrides = {}) {
  return {
    schemaVersion: 'platform-evidence/v1',
    evidenceKind: 'harness-self-test',
    runId: 'synthetic-run',
    build: {
      sha: 'a'.repeat(40),
      artifact: { sha256: 'b'.repeat(64), format: 'synthetic' }
    },
    environment: {
      os: 'linux',
      osVersion: 'synthetic',
      arch: 'x64',
      classification: 'vm',
      installation: 'source',
      runtimeVersions: { node: '22.23.3' }
    },
    fixture: { id: 'synthetic-fixture', sha256: 'c'.repeat(64) },
    scenario: {
      id: 'offline-core',
      expected: 'Synthetic contract expectation.'
    },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    outcome: {
      status: 'pass',
      actual: 'Synthetic harness observation.',
      blockers: []
    },
    assertions: [
      {
        id: 'synthetic-assertion',
        status: 'pass',
        expected: 'Synthetic result.',
        actual: 'Synthetic result.'
      }
    ],
    attachments: [],
    ...overrides
  }
}
test('deterministic seeded fixtures have strict scope and route contracts', () => {
  assert.deepEqual(generateFixture(7), generateFixture(7))
  assert.notDeepEqual(generateFixture(7), generateFixture(8))
  const fixture = generateFixture()
  assert.throws(() => validateFixture({ ...fixture, synthetic: false }))
  assert.throws(() => validateFixture({ ...fixture, unexpected: true }))
  assert.throws(() =>
    validateFixture({
      ...fixture,
      clock: { ...fixture.clock, now: '2026-02-30T00:00:00.000Z' }
    })
  )
  assert.throws(() =>
    validateFixture({
      ...fixture,
      upstream: {
        responses: [
          ...fixture.upstream.responses,
          fixture.upstream.responses[0]
        ]
      }
    })
  )
  assert.throws(() =>
    validateFixture({
      ...fixture,
      network: { mode: 'deny', allowedOrigins: ['https://example.invalid'] }
    })
  )
})
test('product acceptance cannot inherit source, missing artifact or failed assertions', () => {
  assert.equal(validateEvidence(evidence()).evidenceKind, 'harness-self-test')
  assert.throws(() =>
    validateEvidence(evidence({ evidenceKind: 'product-acceptance' }))
  )
  const record = evidence({ evidenceKind: 'product-acceptance' })
  record.environment.installation = 'existing-install'
  validateEvidence(record)
  record.build.artifact = null
  assert.throws(() => validateEvidence(record))
  assert.throws(() => validateEvidence(evidence({ assertions: [] })))
  assert.throws(() =>
    validateEvidence(
      evidence({
        assertions: [
          { id: 'broken', status: 'fail', expected: 'pass', actual: 'fail' }
        ]
      })
    )
  )
  assert.throws(() =>
    validateEvidence(evidence({ completedAt: '2025-12-31T00:00:00.000Z' }))
  )
  assert.throws(() =>
    validateEvidence(
      evidence({
        outcome: { status: 'blocked', actual: 'Unavailable.', blockers: [] }
      })
    )
  )
})
test('emulator or harness records never qualify physical mobile release tests', () => {
  const record = evidence({ evidenceKind: 'product-acceptance' })
  record.environment = {
    ...record.environment,
    os: 'android',
    installation: 'existing-install',
    classification: 'emulator'
  }
  assert.equal(qualifiesPhysicalMobile(record), false)
  record.environment.classification = 'physical'
  assert.equal(qualifiesPhysicalMobile(record), true)
  record.evidenceKind = 'harness-self-test'
  assert.equal(qualifiesPhysicalMobile(record), false)
})
test('nested and commonly encoded canaries fail closed', () => {
  const canaries = generateFixture().canaries
  const value = canaries[0].value
  for (const text of [
    value,
    [...Buffer.from(value)]
      .map((byte) => `%${byte.toString(16).padStart(2, '0')}`)
      .join(''),
    [...Buffer.from(value)]
      .map((byte) => `\\u00${byte.toString(16).padStart(2, '0')}`)
      .join(''),
    Buffer.from(value).toString('base64'),
    Buffer.from(value).toString('base64url'),
    Buffer.from(value).toString('hex'),
    Buffer.from(Buffer.from(value).toString('base64')).toString('base64')
  ])
    assert.throws(() =>
      assertNoCanaries({ nested: [{ captured: text }] }, canaries)
    )
  assertNoCanaries({ actual: 'A sanitized synthetic observation.' }, canaries)
})
test('fixture service binds loopback and rejects undeclared routes and capabilities', async () => {
  const server = await fixtureServer(generateFixture())
  try {
    assert.equal(new URL(server.origin).hostname, '127.0.0.1')
    assert.equal((await fetch(`${server.origin}/fixture/player`)).status, 200)
    assert.equal((await fetch(`${server.origin}/fixture/guild`)).status, 403)
    assert.equal(
      (await fetch(`${server.origin}/fixture/player?scope=all`)).status,
      403
    )
    assert.equal(
      (await fetch(`${server.origin}/fixture/player`, { method: 'POST' }))
        .status,
      403
    )
    assert.deepEqual(server.observed, { matched: 2, denied: 2, oversized: 0 })
  } finally {
    await server.stop()
  }
})
