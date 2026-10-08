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
