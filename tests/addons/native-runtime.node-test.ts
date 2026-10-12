import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeAddonRuntime } from '../../apps/addons/native-runtime'
import { fixturePolicy, war, replay } from './fixtures'
import { createAddonCommands } from '../../apps/addons/commands'
import { AddonHost } from '../../packages/addon-host/src/host'
import { parseOfflineImport } from '../../packages/addon-host/src/offline'

test('native command facade verifies packages, preserves offline data through updates and isolates removal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-addon-'))
  try {
    const fixtures = fixturePolicy()
    const policy = {
      schemaVersion: 1,
      coreVersion: '1.0.0',
      trustedKeys: Object.fromEntries(
        [...fixtures.policy.trustedKeys].map(([id, key]) => [
          id,
          key.export({ type: 'spki', format: 'pem' }).toString()
        ])
      ),
      revokedKeyIds: [],
      approvedReviews: [...fixtures.policy.approvedReviews],
      approvedRightsReceipts: [...fixtures.policy.approvedRightsReceipts]
    }
    let runtime = createNativeAddonRuntime(root, policy)
    const binding = {
      accountHandle: 'synthetic-owner',
      guildHandle: 'synthetic-guild'
    }
    runtime.setBinding(binding)
    const dispatch = (method: string, ...args: unknown[]) =>
      runtime.dispatch({ method, args })
    for (const id of ['guild-war', 'replays'] as const) {
      const staged = (await dispatch(
        'stagePackage',
        JSON.stringify(fixtures.bundle(id))
      )) as any
      await dispatch('activate', staged.digest, staged.manifest.capabilities)
      await dispatch(
        'importLocalData',
        id,
        JSON.stringify(id === 'guild-war' ? war : replay)
      )
    }
    assert.equal(
      ((await dispatch('view', 'guild-war')) as any).report.points,
      270
    )
    const staged = (await dispatch(
      'stagePackage',
      JSON.stringify(fixtures.bundle('guild-war', '1.1.0'))
    )) as any
    await dispatch('activate', staged.digest, staged.manifest.capabilities)
    await dispatch('rollback', 'guild-war')
    await dispatch('setEnabled', 'guild-war', false)
    await assert.rejects(dispatch('view', 'guild-war'), /addon-disabled/)
    await dispatch('setEnabled', 'guild-war', true)
    runtime = createNativeAddonRuntime(root, policy)
    runtime.setBinding(binding)
    assert.equal(
      ((await dispatch('view', 'guild-war')) as any).report.points,
      270
    )
    runtime.setBinding({ ...binding, guildHandle: 'another-guild' })
    await assert.rejects(dispatch('view', 'guild-war'), /no-local-data/)
    runtime.setBinding(binding)
    await dispatch('uninstall', 'guild-war', 'delete')
    assert.equal(
      ((await dispatch('view', 'replays')) as any).addonId,
      'replays'
    )
    for (const request of [
      { method: 'constructor', args: [] },
      { method: 'view', args: ['guild-war'], path: '/tmp/forged' },
      { method: 'setBinding', args: [binding] },
      { method: 'uninstall', args: ['replays', 'all'] },
      { method: 'stagePackage', args: ['x'.repeat(12_582_913)] }
    ])
      await assert.rejects(runtime.dispatch(request))
    const changed = fixtures.bundle('replays')
    changed.files[0]!.base64 = Buffer.from('changed').toString('base64')
    await assert.rejects(
      dispatch('stagePackage', JSON.stringify(changed)),
      /invalid-package/
    )
    const closed = createNativeAddonRuntime(root, {
      ...policy,
      trustedKeys: {}
    })
    await assert.rejects(
      closed.dispatch({
        method: 'stagePackage',
        args: [JSON.stringify(fixtures.bundle('replays'))]
      }),
      /untrusted-package/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function exportFixture() {
  const fixture = fixturePolicy()
  const policy = {
    schemaVersion: 1,
    coreVersion: '1.0.0',
    trustedKeys: Object.fromEntries(
      [...fixture.policy.trustedKeys].map(([id, key]) => [
        id,
        key.export({ type: 'spki', format: 'pem' }).toString()
      ])
    ),
    revokedKeyIds: [],
    approvedReviews: [...fixture.policy.approvedReviews],
    approvedRightsReceipts: [...fixture.policy.approvedRightsReceipts]
  }
  return { fixture, policy }
}

test('fixed export method roundtrips both formats without exposing destination arguments or changing host/core data', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'native-export-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { fixture, policy } = exportFixture(),
    runtime = createNativeAddonRuntime(root, policy)
  runtime.setBinding({
    accountHandle: 'synthetic-export-owner',
    guildHandle: 'synthetic-export-guild'
  })
  const core = join(root, 'synthetic-core.txt')
  writeFileSync(core, 'synthetic-core-preserved')
  const dispatch = (method: string, ...args: unknown[]) =>
    runtime.dispatch({ method, args })
  for (const id of ['guild-war', 'replays'] as const) {
    const staged = await dispatch(
      'stagePackage',
      JSON.stringify(fixture.bundle(id))
    )
    assert.ok(staged && !Array.isArray(staged) && 'manifest' in staged)
    await dispatch('activate', staged.digest, staged.manifest.capabilities)
    await dispatch(
      'importLocalData',
      id,
      JSON.stringify(id === 'guild-war' ? war : replay)
    )
  }
  const before = readFileSync(join(root, 'registry.json'))
  for (const id of ['guild-war', 'replays'] as const) {
    let saved = '',
      lateRead: (() => string) | undefined
    assert.equal(
      await runtime.dispatch(
        { method: 'exportLocalData', args: [id] },
        async (selected, read) => {
          assert.equal(selected, id)
          saved = read()
          lateRead = read
        }
      ),
      undefined
    )
    assert.deepEqual(
      parseOfflineImport(id, saved),
      id === 'guild-war' ? war : replay
    )
    assert.ok(Buffer.byteLength(saved) <= 2_097_152)
    assert.throws(() => lateRead!(), /invalid-session/)
    await assert.rejects(dispatch('exportLocalData', id), /invalid-session/)
  }
  for (const request of [
    {
      method: 'exportLocalData',
      args: ['guild-war', '/tmp/synthetic-forged.json']
    },
    { method: 'exportLocalData', args: ['guild-war', '{}'] },
    {
      method: 'exportLocalData',
      args: ['guild-war'],
      path: '/tmp/synthetic-forged.json'
    },
    { method: 'exportLocalData', args: ['other-module'] },
    { method: 'exportLocalData', args: [] },
    { method: 'exportAllData', args: [] }
  ]) {
    let called = false
    await assert.rejects(
      runtime.dispatch(request, async () => {
        called = true
      })
    )
    assert.equal(called, false)
  }
  assert.deepEqual(readFileSync(join(root, 'registry.json')), before)
  assert.equal(readFileSync(core, 'utf8'), 'synthetic-core-preserved')
})

for (const change of [
  'binding-roundtrip',
  'disable-roundtrip',
  'revocation',
  'explicit-epoch'
] as const) {
  test(`export retains original host session and refuses ${change} while trusted destination is pending`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'export-epoch-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const fixture = fixturePolicy(),
      host = new AddonHost(root, fixture.policy)
    const binding = {
      accountHandle: 'synthetic-export-owner',
      guildHandle: 'synthetic-export-guild'
    }
    host.setBinding(binding)
    const staged = host.stage(fixture.bundle('guild-war'))
    host.activate(staged.digest, staged.manifest.capabilities)
    host.importData(host.openSession('guild-war'), JSON.stringify(war))
    let release!: () => void
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    let writes = 0
    const commands = createAddonCommands(host, async (_id, read) => {
      entered()
      await paused
      read()
      writes += 1
    })
    assert.equal(typeof commands.exportLocalData, 'function')
    const saving = commands.exportLocalData('guild-war')
    await Promise.race([
      waiting,
      saving.then(
        () => assert.fail('Save completed before destination'),
        (error) => {
          throw error
        }
      )
    ])
    if (change === 'binding-roundtrip') {
      host.setBinding({ ...binding, guildHandle: 'synthetic-other-guild' })
      host.setBinding(binding)
    } else if (change === 'disable-roundtrip') {
      host.setEnabled('guild-war', false)
      host.setEnabled('guild-war', true)
    } else if (change === 'revocation') {
      ;(fixture.policy.revokedKeyIds as Set<string>).add('synthetic-test-key')
    } else host.invalidate()
    release()
    await assert.rejects(saving, /invalid-session|untrusted-package/)
    assert.equal(writes, 0)
  })
}

test('export checks enabled/read/current data before showing a destination and always closes cancelled or refused sessions', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'export-permission-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixture = fixturePolicy(),
    host = new AddonHost(root, fixture.policy)
  const staged = host.stage(
    fixture.bundle('guild-war', '1.0.0', { capabilities: ['offline.import'] })
  )
  host.activate(staged.digest, staged.manifest.capabilities)
  host.setBinding({
    accountHandle: 'synthetic-export-owner',
    guildHandle: 'synthetic-export-guild'
  })
  host.importData(host.openSession('guild-war'), JSON.stringify(war))
  let dialogs = 0
  const commands = createAddonCommands(host, async () => {
    dialogs += 1
  })
  assert.equal(typeof commands.exportLocalData, 'function')
  await assert.rejects(commands.exportLocalData('guild-war'), /invalid-session/)
  host.setEnabled('guild-war', false)
  await assert.rejects(commands.exportLocalData('guild-war'), /addon-disabled/)
  assert.equal(dialogs, 0)
})
