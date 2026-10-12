import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveQualificationTarget } from '../../../apps/desktop/platform/macos/dns-retry.mjs'

test('resolves the target on the first attempt without retrying', async () => {
  const calls = []
  const resolveHost = async (host, options) => {
    calls.push({ host, options })
    return { address: '93.184.216.34', family: 4 }
  }
  const target = await resolveQualificationTarget('example.com', {
    resolveHost,
    timeoutMs: 50
  })
  assert.deepEqual(target, { address: '93.184.216.34', family: 4 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].host, 'example.com')
  assert.deepEqual(calls[0].options, { family: 4 })
})

test('retries transient lookup failures before succeeding', async () => {
  let attempts = 0
  const resolveHost = async () => {
    attempts++
    if (attempts < 3) throw new Error('ENOTFOUND')
    return { address: '93.184.216.34', family: 4 }
  }
  const target = await resolveQualificationTarget('example.com', {
    resolveHost,
    timeoutMs: 50,
    pauseMs: 1
  })
  assert.equal(attempts, 3)
  assert.equal(target.address, '93.184.216.34')
})

test('throws the timeout error after exhausting every attempt', async () => {
  let attempts = 0
  const resolveHost = async () => {
    attempts++
    return new Promise(() => {})
  }
  await assert.rejects(
    resolveQualificationTarget('example.com', {
      resolveHost,
      timeoutMs: 10,
      pauseMs: 1
    }),
    /Qualification DNS timed out/
  )
  assert.equal(attempts, 3)
})

test('pauses between attempts before the final failure', async () => {
  const timestamps = []
  const resolveHost = async () => {
    timestamps.push(performance.now())
    throw new Error('ENOTFOUND')
  }
  await assert.rejects(
    resolveQualificationTarget('example.com', {
      resolveHost,
      timeoutMs: 10,
      pauseMs: 30
    }),
    /ENOTFOUND/
  )
  assert.equal(timestamps.length, 3)
  assert.ok(timestamps[1] - timestamps[0] >= 25)
  assert.ok(timestamps[2] - timestamps[1] >= 25)
})
