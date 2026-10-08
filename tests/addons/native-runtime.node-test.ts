import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeAddonRuntime } from '../../apps/addons/native-runtime'
import { fixturePolicy, war, replay } from './fixtures'

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
