import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AddonError,
  AddonHost,
  sha256
} from '../../packages/addon-host/src/host'
import {
  canonicalJson,
  type Platform
} from '../../packages/addon-host/src/contract'
import { fixturePolicy, replay, war } from './fixtures'

function setup(t: test.TestContext, platform: Platform = 'linux') {
  const root = mkdtempSync(join(tmpdir(), 'addon-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixture = fixturePolicy({ platform }),
    host = new AddonHost(root, fixture.policy)
  const install = (id: 'guild-war' | 'replays', version?: string) => {
    const staged = host.stage(fixture.bundle(id, version))
    host.activate(staged.digest, staged.manifest.capabilities)
    return staged
  }
  return { root, host, install, ...fixture }
}

for (const platform of [
  'linux',
  'macos',
  'windows',
  'android',
  'ios'
] as const) {
  test(`host policy ${platform}: independent offline lifecycle and restart (not native-device proof)`, (t) => {
    const { host, root, policy, install } = setup(t, platform)
    const coreMarker = join(root, 'unrelated-core-marker.txt')
    writeFileSync(coreMarker, 'retained-core')
    install('guild-war')
    install('replays')
    host.setBinding({
      accountHandle: 'synthetic-account',
      guildHandle: 'synthetic-guild'
    })
    const warSession = host.openSession('guild-war'),
      replaySession = host.openSession('replays')
    host.importData(warSession, JSON.stringify(war))
    host.importData(replaySession, JSON.stringify(replay))
    const pending = host.jobSignal(warSession)
    host.setEnabled('guild-war', false)
    assert.equal(pending.aborted, true)
    assert.throws(() => host.readData(warSession), AddonError)
    assert.deepEqual(host.readData(replaySession), replay)
    host.setEnabled('guild-war', true)
    install('guild-war', '1.1.0')
    assert.equal(
      host.list().find((item) => item.addonId === 'guild-war')?.version,
      '1.1.0'
    )
    host.rollback('guild-war')
    assert.equal(
      host.list().find((item) => item.addonId === 'guild-war')?.version,
      '1.0.0'
    )
    host.uninstall('guild-war', 'retain')
    install('guild-war')
    const reopened = new AddonHost(root, policy)
    reopened.setBinding({
      accountHandle: 'synthetic-account',
      guildHandle: 'synthetic-guild'
    })
    assert.deepEqual(reopened.readData(reopened.openSession('guild-war')), war)
    assert.deepEqual(reopened.readData(reopened.openSession('replays')), replay)
    reopened.uninstall('guild-war', 'delete')
    install('guild-war')
    assert.throws(
      () => reopened.readData(reopened.openSession('guild-war')),
      /no-local-data/
    )
    assert.deepEqual(reopened.readData(reopened.openSession('replays')), replay)
    assert.equal(readFileSync(coreMarker, 'utf8'), 'retained-core')
  })
}

test('rejects unsigned, unknown-key, revoked, substituted, unreviewed and unapproved-rights packages', (t) => {
  const { host, policy, bundle } = setup(t)
  const valid = bundle('guild-war')
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const last = valid.envelope.signature.value.length - 3
  const noncanonicalSignature =
    valid.envelope.signature.value.slice(0, last) +
    alphabet[alphabet.indexOf(valid.envelope.signature.value[last]) + 1] +
    '=='
  assert.deepEqual(
    Buffer.from(noncanonicalSignature, 'base64'),
    Buffer.from(valid.envelope.signature.value, 'base64')
  )
  const invalid = [
    {
      ...valid,
      envelope: {
        ...valid.envelope,
        signature: { ...valid.envelope.signature, value: noncanonicalSignature }
      }
    },
    { ...valid, envelope: { manifest: valid.envelope.manifest } },
    {
      ...valid,
      envelope: {
        ...valid.envelope,
        signature: { ...valid.envelope.signature, keyId: 'unknown' }
      }
    },
    {
      ...valid,
      envelope: {
        ...valid.envelope,
        manifest: { ...valid.envelope.manifest, version: '9.9.9' }
      }
    },
    {
      ...valid,
      files: valid.files.map((file) => ({
        ...file,
        base64: Buffer.from('substituted').toString('base64')
      }))
    },
    bundle('guild-war', '1.0.0', {
      source: {
        ...valid.envelope.manifest.source,
        reviewSha256: sha256('unreviewed')
      }
    }),
    bundle('guild-war', '1.0.0', {
      source: {
        ...valid.envelope.manifest.source,
        rightsReceiptSha256: sha256('unapproved')
      }
    })
  ]
  for (const value of invalid)
    assert.throws(() => host.stage(value), AddonError)
  ;(policy.revokedKeyIds as Set<string>).add('synthetic-test-key')
  assert.throws(() => host.stage(valid), /untrusted-package/)
  assert.deepEqual(host.list(), [])
})

test('rejects wrong platform, architecture, schema, core range and duplicate/traversal/extra files', (t) => {
  const { host, bundle } = setup(t),
    compat = bundle('guild-war').envelope.manifest.compatibility
  for (const compatibility of [
    { ...compat, platforms: ['ios'] },
    { ...compat, architectures: ['arm64'] },
    { ...compat, coreMinVersion: '2.0.0' },
    { ...compat, coreMaxVersion: '0.0.1' },
    { ...compat, dataSchemaVersion: 2 }
  ]) {
    assert.throws(
      () =>
        host.stage(bundle('guild-war', '1.0.0', { compatibility } as never)),
      AddonError
    )
  }
  const valid = bundle('guild-war')
  for (const files of [
    [...valid.files, valid.files[0]],
    [{ ...valid.files[0], path: '../../core.json' }, valid.files[1]],
    [...valid.files, { path: 'script.js', base64: 'AA==' }]
  ])
    assert.throws(() => host.stage({ ...valid, files }), AddonError)
})

test('activation re-verifies immutable staged data and checks exact permission approval', (t) => {
  const { host, root, bundle } = setup(t)
  const staged = host.stage(bundle('guild-war'))
  assert.throws(
    () => host.activate(staged.digest, ['offline.read']),
    /approval-required/
  )
  const path = join(root, 'packages', `${staged.digest}.json`)
  writeFileSync(path, JSON.stringify({ invalid: true }))
  assert.throws(
    () => host.activate(staged.digest, staged.manifest.capabilities),
    /invalid-package/
  )
  assert.deepEqual(host.list(), [])
})

test('interrupted activation and failed update retain launchable version and data', (t) => {
  const { host, policy, root, bundle, install } = setup(t)
  const original = install('guild-war')
  host.setBinding({
    accountHandle: 'synthetic-account',
    guildHandle: 'synthetic-guild'
  })
  host.importData(host.openSession('guild-war'), JSON.stringify(war))
  const staged = host.stage(bundle('guild-war', '1.1.0'))
  const previousBytes = readFileSync(join(root, 'registry.json'), 'utf8')
  policy.beforeCommit = () => {
    throw new Error('synthetic failure')
  }
  assert.throws(
    () => host.activate(staged.digest, staged.manifest.capabilities),
    /update-failed/
  )
  assert.equal(readFileSync(join(root, 'registry.json'), 'utf8'), previousBytes)
  delete policy.beforeCommit
  const reopened = new AddonHost(root, policy)
  reopened.setBinding({
    accountHandle: 'synthetic-account',
    guildHandle: 'synthetic-guild'
  })
  assert.equal(reopened.list()[0].digest, original.digest)
  assert.deepEqual(reopened.readData(reopened.openSession('guild-war')), war)
  writeFileSync(join(root, 'registry-interrupted.tmp'), 'partial interruption')
  assert.deepEqual(new AddonHost(root, policy).list(), reopened.list())
})

test('permission expansion is explicit and rollback never silently grants additional capabilities', (t) => {
  const { host, bundle, install } = setup(t)
  install('guild-war')
  const update = host.stage(
    bundle('guild-war', '1.1.0', {
      capabilities: ['offline.read', 'offline.import', 'broker.guild-war.read']
    })
  )
  assert.throws(
    () => host.activate(update.digest, ['offline.read', 'offline.import']),
    /approval-required/
  )
  host.activate(update.digest, update.manifest.capabilities)
  host.rollback('guild-war')
  assert.throws(() => host.rollback('guild-war'), /approval-required/)
})

test('account/guild switches revoke sessions and preserve independently bound historical data', (t) => {
  const { host, install } = setup(t)
  install('guild-war')
  install('replays')
  host.setBinding({
    accountHandle: 'synthetic-a',
    guildHandle: 'synthetic-guild-a'
  })
  const first = host.openSession('guild-war'),
    signal = host.jobSignal(first)
  host.importData(first, JSON.stringify(war))
  host.setBinding({
    accountHandle: 'synthetic-b',
    guildHandle: 'synthetic-guild-b'
  })
  assert.equal(signal.aborted, true)
  assert.throws(() => host.readData(first), /invalid-session/)
  assert.throws(
    () => host.readData(host.openSession('guild-war')),
    /no-local-data/
  )
  host.setBinding({
    accountHandle: 'synthetic-a',
    guildHandle: 'synthetic-guild-a'
  })
  assert.deepEqual(host.readData(host.openSession('guild-war')), war)
  host.setBinding({ accountHandle: 'synthetic-a', guildHandle: null })
  assert.throws(() => host.openSession('guild-war'), /invalid-session/)
})

test('dependencies are digest-pinned, runtime checked and cannot read another module data', (t) => {
  const { host, bundle, install } = setup(t)
  const warPackage = install('guild-war')
  const staged = host.stage(
    bundle('replays', '1.0.0', {
      dependencies: [
        {
          addonId: 'guild-war',
          version: '1.0.0',
          packageSha256: warPackage.digest
        }
      ]
    })
  )
  host.activate(staged.digest, staged.manifest.capabilities)
  host.setBinding({
    accountHandle: 'synthetic-account',
    guildHandle: 'synthetic-guild'
  })
  host.importData(host.openSession('guild-war'), JSON.stringify(war))
  const replaySession = host.openSession('replays')
  assert.throws(() => host.readData(replaySession), /no-local-data/)
  assert.throws(
    () => host.importData(replaySession, JSON.stringify(war)),
    /malformed/
  )
  const job = host.jobSignal(replaySession)
  host.setEnabled('guild-war', false)
  assert.equal(job.aborted, true)
  assert.throws(() => host.readData(replaySession), /invalid-session/)
})

test('a revoked installed package stays listed as unavailable and can be uninstalled', (t) => {
  const { host, policy, install } = setup(t)
  install('guild-war')
  install('replays')
  ;(policy.revokedKeyIds as Set<string>).add('synthetic-test-key')
  const listed = host.list()
  assert.equal(listed.length, 2)
  assert.ok(listed.every((item) => item.unavailable && !item.enabled))
  host.uninstall('guild-war', 'retain')
  assert.deepEqual(
    host.list().map((item) => item.addonId),
    ['replays']
  )
})

test('storage rejects symlinks, traversal digests and retained transaction locks', (t) => {
  const { host, root, bundle } = setup(t)
  assert.throws(
    () => host.activate('../../other', ['offline.read']),
    /invalid-package/
  )
  const victim = join(root, 'victim.txt')
  writeFileSync(victim, 'unrelated')
  symlinkSync(victim, join(root, 'registry.json'))
  assert.throws(() => host.list(), /recoverable-storage/)
  assert.equal(readFileSync(victim, 'utf8'), 'unrelated')
  rmSync(join(root, 'registry.json'))
  writeFileSync(join(root, 'transaction.lock'), 'interrupted-owner')
  assert.throws(() => host.stage(bundle('guild-war')), /transaction-busy/)
  assert.deepEqual(host.list(), [])
})

test('package path replacement after open cannot change the checked bytes', (t) => {
  const { host, root, bundle } = setup(t),
    input = bundle('guild-war')
  const staged = host.stage(input),
    target = join(root, 'packages', `${staged.digest}.json`)
  const victim = join(root, 'unrelated-target.txt')
  writeFileSync(victim, 'synthetic-forbidden-canary')
  const realFstat = fs.fstatSync
  let replaced = false
  const spy = t.mock.method(fs, 'fstatSync', (fd: number) => {
    const stat = realFstat(fd)
    if (!replaced) {
      replaced = true
      fs.renameSync(target, `${target}.original`)
      symlinkSync(victim, target)
    }
    return stat
  })
  syncBuiltinESMExports()
  try {
    assert.equal(host.stage(input).digest, staged.digest)
    assert.equal(replaced, true)
    assert.throws(
      () => host.activate(staged.digest, staged.manifest.capabilities),
      /invalid-package/
    )
    assert.equal(readFileSync(victim, 'utf8'), 'synthetic-forbidden-canary')
  } finally {
    spy.mock.restore()
    syncBuiltinESMExports()
  }
})

test('synthetic secret canaries in nested/encoded fields never enter errors, state, exports or diagnostics', (t) => {
  const { host, root, install } = setup(t)
  install('guild-war')
  host.setBinding({
    accountHandle: 'synthetic-account',
    guildHandle: 'synthetic-guild'
  })
  const session = host.openSession('guild-war'),
    canary = 'synthetic-forbidden-canary',
    encoded = Buffer.from(canary).toString('base64')
  host.importData(session, JSON.stringify(war))
  const surfaces: string[] = []
  for (const data of [
    { ...war, credentials: { nested: canary } },
    { ...war, metadata: { encoded } },
    { ...war, battles: [{ ...war.battles[0], secret: canary }] }
  ]) {
    try {
      host.importData(session, JSON.stringify(data))
      assert.fail('invalid import accepted')
    } catch (error) {
      surfaces.push(String(error))
    }
  }
  surfaces.push(
    readFileSync(join(root, 'registry.json'), 'utf8'),
    host.exportModuleData(session),
    canonicalJson(host.diagnostics())
  )
  for (const surface of surfaces) {
    assert.equal(surface.includes(canary), false)
    assert.equal(surface.includes(encoded), false)
  }
})
