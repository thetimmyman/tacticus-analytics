import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { defaultConsent } from '../../packages/contribution/contract.mjs'
import { ContributionQueue } from '../../packages/contribution/queue.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const accountRef = id(4)
const guildId = id(1)
const bindingId = id(5)
const NOW = Date.parse('2026-01-01T00:01:00.000Z')
const row = {
  userId: id(2),
  tier: 1,
  set: 0,
  encounterIndex: 0,
  damageDealt: 100,
  damageType: 'Battle',
  startedOn: '1767225600',
  completedOn: '1767225610',
  unitId: 'SyntheticBoss'
}

const policy = (purpose, extra = {}) => ({
  ...defaultConsent({
    accountRef,
    guildId,
    purpose,
    now: '2026-01-01T00:00:00.000Z'
  }),
  revision: 1,
  enabled: true,
  datasets: { raid: true, war: false, replay: false },
  ...extra
})

const upload = (purpose, revision = 1) => ({
  version: 1,
  requestId: randomUUID(),
  bindingId,
  consentRevision: revision,
  purpose,
  dataset: 'raid',
  guildId,
  season: 1,
  observedAt: new Date(NOW).toISOString(),
  rows: [structuredClone(row)]
})

const receiptFor = (sent) => ({
  version: 1,
  requestId: sent.requestId,
  consentRevision: sent.consentRevision,
  checkedAt: new Date(NOW).toISOString(),
  source: 'official-guild-raid',
  results: [{ index: 0, status: 'verified', authorityDigest: 'a'.repeat(64) }]
})

function queueFixture(t, purposes = ['meta', 'portal']) {
  const directory = mkdtempSync(join(tmpdir(), 'purpose-isolation-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const queue = new ContributionQueue({
    path: join(directory, 'queue.json'),
    now: () => NOW
  })
  for (const purpose of purposes) queue.setPolicy(policy(purpose))
  return queue
}

test('switching one purpose off drains nothing through the other purpose queue', async (t) => {
  const queue = queueFixture(t)
  queue.enqueue(accountRef, upload('meta'))
  queue.enqueue(accountRef, upload('portal'))
  assert.equal(queue.inspect().pending.length, 2)

  queue.setPolicy(policy('meta', { revision: 2, enabled: false }))
  assert.deepEqual(
    queue.inspect().pending.map((job) => job.purpose),
    ['portal']
  )

  const sent = []
  await queue.drain(async (job) => {
    sent.push(job.purpose)
    return receiptFor(job)
  })
  assert.deepEqual(sent, ['portal'])
  assert.equal(queue.inspect().pending.length, 0)
})

test('a purpose without active consent cannot enqueue, even when another purpose is consented', (t) => {
  const queue = queueFixture(t, ['portal'])
  assert.throws(
    () => queue.enqueue(accountRef, upload('meta')),
    /consent is not active/
  )
  queue.enqueue(accountRef, upload('portal'))
  assert.equal(queue.inspect().pending.length, 1)

  queue.setPolicy(policy('portal', { revision: 2, enabled: false }))
  assert.throws(
    () => queue.enqueue(accountRef, upload('portal', 2)),
    /consent is not active/
  )
})

test('revoking one purpose does not abort or discard an in-flight send of the other', async (t) => {
  const queue = queueFixture(t)
  queue.enqueue(accountRef, upload('portal'))
  let finish, entered
  const arrived = new Promise((resolve) => {
    entered = resolve
  })
  const sending = queue.drain(
    (job, { signal }) =>
      new Promise((resolve) => {
        entered(signal)
        finish = () => resolve(receiptFor(job))
      })
  )
  const signal = await arrived
  queue.setPolicy(policy('meta', { revision: 2, enabled: false }))
  assert.equal(signal.aborted, false)
  finish()
  await sending
  assert.equal(queue.inspect().receipts.at(-1).delivery, 'received')
})

test('a concurrent drain is refused and never resends a job after revocation', async (t) => {
  const queue = queueFixture(t, ['meta'])
  queue.enqueue(accountRef, upload('meta'))
  let finish,
    entered,
    sends = 0
  const arrived = new Promise((resolve) => {
    entered = resolve
  })
  const first = queue.drain(
    (job) =>
      new Promise((resolve) => {
        sends++
        entered()
        finish = () => resolve(receiptFor(job))
      })
  )
  await arrived
  await assert.rejects(
    queue.drain(async () => {
      sends++
    }),
    /already sending/
  )
  queue.setPolicy(policy('meta', { revision: 2, enabled: false }))
  finish()
  await first

  await queue.drain(async () => {
    sends++
  })
  assert.equal(sends, 1)
  assert.equal(queue.inspect().pending.length, 0)
  assert.equal(
    queue.inspect().receipts.at(-1).delivery,
    'sent-before-revocation'
  )
})
