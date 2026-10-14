import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceDiagnostics } from '../../../apps/desktop/platform/windows/workspace-diagnostics.mjs'

test('verification evidence distinguishes queued and stalled local access without private values', () => {
  let now = 0
  const diagnostics = workspaceDiagnostics(() => now)
  const first = diagnostics.begin('access-status')
  first.stage('native-session')
  const second = diagnostics.begin('access-status')
  now = 250
  assert.deepEqual(diagnostics.snapshot(), [
    {
      kind: 'access-status',
      stage: 'native-session',
      outcome: 'pending',
      elapsedMs: 250
    },
    {
      kind: 'access-status',
      stage: 'queue',
      outcome: 'pending',
      elapsedMs: 250
    }
  ])
  first.stage('synthetic-private-value')
  first.finish(401)
  second.stage('local-status')
  second.finish(200)
  now = 500
  assert.deepEqual(diagnostics.snapshot(), [
    {
      kind: 'access-status',
      stage: 'native-session',
      outcome: 'refused',
      status: 401,
      elapsedMs: 250
    },
    {
      kind: 'access-status',
      stage: 'local-status',
      outcome: 'complete',
      status: 200,
      elapsedMs: 250
    }
  ])
  assert.equal(diagnostics.begin('/private/url?token=synthetic'), undefined)
  assert.equal(
    JSON.stringify(diagnostics.snapshot()).includes('private'),
    false
  )
  for (let i = 0; i < 100; i++) diagnostics.begin('official-state')
  assert.equal(diagnostics.snapshot().length, 32)
})
