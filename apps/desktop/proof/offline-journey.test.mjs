import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildOfflineUnshareArgs } from './offline-journey.mjs'

// Gate (b) command-shape self-test: exercises the unshare argv builder in
// isolation, needing no real unshare/postgres/network-namespace support.
// See offline-journey.mjs's buildOfflineUnshareArgs doc comment for why.

test('buildOfflineUnshareArgs creates the offline netns and restores the real uid/gid before exec', () => {
  const args = buildOfflineUnshareArgs({
    uid: 1000,
    gid: 1000,
    journeyPath: '/abs/native-journey.mts',
    configPath: '/abs/config.json'
  })
  assert.deepEqual(args.slice(0, 3), ['-rn', '--', 'sh'])
  assert.equal(args[3], '-c')
  const command = args[4]
  assert.match(command, /^ip link set lo up && 'exec' 'unshare' /)
  assert.match(command, /'--map-user=1000'/)
  assert.match(command, /'--map-group=1000'/)
  assert.match(
    command,
    /'node' '--conditions=react-server' '--import' 'tsx' '\/abs\/native-journey\.mts' '\/abs\/config\.json'$/
  )
})

test('buildOfflineUnshareArgs maps a different uid/gid pair through to --map-user/--map-group', () => {
  const [, , , , command] = buildOfflineUnshareArgs({
    uid: 501,
    gid: 20,
    journeyPath: '/abs/native-journey.mts',
    configPath: '/abs/config.json'
  })
  assert.match(command, /'--map-user=501'/)
  assert.match(command, /'--map-group=20'/)
})

test('buildOfflineUnshareArgs single-quotes a config path containing a single quote', () => {
  const [, , , , command] = buildOfflineUnshareArgs({
    uid: 1000,
    gid: 1000,
    journeyPath: '/abs/native-journey.mts',
    configPath: "/abs/odd'path/config.json"
  })
  assert.ok(command.includes("'/abs/odd'\\''path/config.json'"))
})

test('buildOfflineUnshareArgs rejects a non-integer or negative uid/gid', () => {
  assert.throws(() =>
    buildOfflineUnshareArgs({
      uid: -1,
      gid: 1000,
      journeyPath: '/abs/native-journey.mts',
      configPath: '/abs/config.json'
    })
  )
  assert.throws(() =>
    buildOfflineUnshareArgs({
      uid: 1000,
      gid: 1.5,
      journeyPath: '/abs/native-journey.mts',
      configPath: '/abs/config.json'
    })
  )
})
