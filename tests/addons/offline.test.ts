import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IMPORT_LIMITS,
  ImportError,
  parseOfflineImport,
  replayFrame,
  replaySchema,
  summarizeWar,
  warSchema
} from '../../packages/addon-host/src/offline'
import { replay, war } from './fixtures'

test('offline war report totals and replay seek are deterministic without credentials/assets', () => {
  assert.deepEqual(summarizeWar(warSchema.parse(war)).zones, [
    { zone: 1, battles: 2, points: 270 }
  ])
  const timeline = replaySchema.parse(replay)
  assert.deepEqual(replayFrame(timeline, 500).entities, [
    { entity: 1, side: 'allies', x: 2, y: 2, hp: 70 }
  ])
  assert.deepEqual(replayFrame(timeline, 100).entities, [
    { entity: 1, side: 'allies', x: 1, y: 1, hp: 100 }
  ])
  assert.deepEqual(replayFrame(timeline, 800).entities, [])
  assert.equal(
    replayFrame(timeline, 500).provenance,
    'locally-supplied-unverified'
  )
})

test('hostile imports reject archive/traversal/active-content/nested/unsupported format payloads', () => {
  for (const input of [
    'PK\x03\x04',
    'not-json',
    JSON.stringify({ ...replay, path: '../../core.json' }),
    JSON.stringify({ ...replay, script: '<script>active</script>' }),
    JSON.stringify({ ...replay, assets: ['https://example.invalid/model'] }),
    JSON.stringify({ ...replay, format: 'unknown-format-v9' }),
    JSON.stringify({ ...replay, metadata: { nested: 'synthetic-canary' } })
  ])
    assert.throws(() => parseOfflineImport('replays', input), ImportError)
  assert.throws(
    () => parseOfflineImport('replays', ' '.repeat(IMPORT_LIMITS.bytes + 1)),
    ImportError
  )
})

test('replay processing rejects invalid order/resource limits/nonexistent entities and duplicate spawn', () => {
  const first = replay.events[0]
  for (const events of [
    [{ type: 'move', at: 0, entity: 1, x: 1, y: 1 }],
    [first, first],
    [first, { type: 'damage', at: 250, entity: 2, amount: 1 }],
    [first, { type: 'damage', at: 1001, entity: 1, amount: 1 }],
    [first, replay.events[2], replay.events[1]],
    [{ ...first, entity: 101 }],
    [{ ...first, hp: 1e20 }],
    [{ ...first, hp: -1 }],
    Array.from({ length: IMPORT_LIMITS.events + 1 }, () => first)
  ])
    assert.throws(
      () =>
        parseOfflineImport('replays', JSON.stringify({ ...replay, events })),
      ImportError
    )
  const timeline = replaySchema.parse(replay)
  for (const seek of [-1, 1.5, 1001, Infinity, NaN])
    assert.throws(() => replayFrame(timeline, seek), ImportError)
})

test('war imports reject duplicates, out-of-range slots and active fields', () => {
  for (const battles of [
    [war.battles[0], war.battles[0]],
    [{ ...war.battles[0], attackerSlot: 31 }],
    [{ ...war.battles[0], points: -1 }],
    [{ ...war.battles[0], href: 'https://example.invalid' }]
  ])
    assert.throws(
      () =>
        parseOfflineImport('guild-war', JSON.stringify({ ...war, battles })),
      ImportError
    )
})
