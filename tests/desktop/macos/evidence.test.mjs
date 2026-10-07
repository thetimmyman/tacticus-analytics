import test from 'node:test'
import assert from 'node:assert/strict'
import { records } from '../../../apps/desktop/platform/macos/evidence.mjs'

test('installed partial measurements cannot qualify consumer install, personal onboarding or full parity', () => {
  const evidence = records({
    sha: 'a'.repeat(40),
    artifactSha256: 'b'.repeat(64),
    fixtureSha256: 'c'.repeat(64),
    osVersion: '15.0',
    arch: 'arm64',
    runtimeVersions: { node: '22.23.3' },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    attachments: []
  })
  assert.equal(evidence.length, 13)
  assert.deepEqual(
    evidence
      .filter((record) => record.outcome.status === 'pass')
      .map((record) => record.scenario.id),
    ['restart-persistence', 'backup-restore']
  )
  for (const record of evidence) {
    assert.equal(record.environment.classification, 'vm')
    assert.equal(record.build.artifact.sha256, 'b'.repeat(64))
    if (record.outcome.status === 'blocked')
      assert.ok(record.outcome.blockers.length)
  }
})
