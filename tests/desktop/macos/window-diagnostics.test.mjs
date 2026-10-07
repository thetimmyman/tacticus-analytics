import test from 'node:test'
import assert from 'node:assert/strict'
import { windowDiagnostics } from '../../../apps/desktop/platform/macos/window-diagnostics.mjs'

test('native startup diagnostics retain only bounded classifications, never child messages or credentials', () => {
  const observer = windowDiagnostics()
  observer.observe('SYNTHETIC-SECRET Library not loa')
  observer.observe('ded: /synthetic/private/path Code Signature Invalid')
  const value = observer.exit(null, 'SIGKILL')
  assert.deepEqual(value, {
    synthetic: true,
    exitCode: null,
    signal: 'SIGKILL',
    categories: ['code-signature', 'dynamic-loader']
  })
  assert.equal(JSON.stringify(value).includes('SYNTHETIC-SECRET'), false)
  assert.equal(JSON.stringify(value).includes('/synthetic'), false)
  assert.deepEqual(observer.exit('SYNTHETIC-SECRET', 'SYNTHETIC-SECRET'), {
    ...value,
    exitCode: null,
    signal: null
  })
})

test('Chromium sandbox failure literals produce a fixed classification without copying messages', () => {
  for (const literal of [
    'Failed to initialize sandbox.',
    'Failed to create seatbelt sandbox server.',
    'SandboxSerializer: Failed to apply compiled policy',
    'SandboxSerializer: Failed to initialize sandbox with source mode policy',
    'sandbox_apply:'
  ]) {
    const observer = windowDiagnostics()
    observer.observe('SYNTHETIC-SECRET ' + literal + ' /synthetic/private/path')
    const result = observer.exit(null, 'SIGTRAP')
    assert.ok(result.categories.includes('sandbox-initialization'))
    assert.equal(JSON.stringify(result).includes('SYNTHETIC-SECRET'), false)
  }
})
