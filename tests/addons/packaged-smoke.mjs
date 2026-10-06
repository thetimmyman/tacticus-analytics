import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const out = process.argv[2]
if (!out) throw new Error('Provide built component directory')
const { AddonHost, canonicalJson, sha256, replayFrame } = await import(
  pathToFileURL(join(out, 'addon-host.mjs')).href
)
const { createAddonCommands } = await import(
  pathToFileURL(join(out, 'commands.mjs')).href
)
const componentManifest = JSON.parse(
  readFileSync(join(out, 'component-manifest.json'), 'utf8')
)
for (const file of componentManifest.components)
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(out, file.path)))
      .digest('hex'),
    file.sha256
  )
const root = mkdtempSync(join(tmpdir(), 'packaged-addon-'))
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const review = sha256('synthetic-review'),
  rights = sha256('synthetic-rights')
const policy = {
  coreVersion: '1.0.0',
  platform: 'linux',
  architecture: 'x64',
  trustedKeys: new Map([['synthetic-key', publicKey]]),
  revokedKeyIds: new Set(),
  approvedReviews: new Set([review]),
  approvedRightsReceipts: new Set([rights])
}
function bundle(addonId, version) {
  const bytes = Buffer.from(
    canonicalJson({
      schemaVersion: 1,
      addonId,
      format:
        addonId === 'guild-war' ? 'ta-war-summary-v1' : 'ta-replay-timeline-v1'
    })
  )
  const manifest = {
    schemaVersion: 1,
    addonId,
    version,
    publisher: 'tacticus-analytics',
    runtime: 'builtin-vetted-v1',
    source: {
      repository: 'https://github.com/thetimmyman/tacticus-analytics',
      commit: componentManifest.sourceSha,
      reviewSha256: review,
      rightsReceiptSha256: rights
    },
    compatibility: {
      hostApiVersion: 1,
      coreMinVersion: '1.0.0',
      coreMaxVersion: '2.0.0',
      platforms: ['linux'],
      architectures: ['x64'],
      dataSchemaVersion: 1
    },
    capabilities: ['offline.import', 'offline.read'],
    files: [
      {
        path: 'module.json',
        sha256: sha256(bytes),
        bytes: bytes.length,
        kind: 'data'
      }
    ],
    dependencies: []
  }
  return JSON.stringify({
    envelope: {
      manifest,
      signature: {
        algorithm: 'ed25519',
        keyId: 'synthetic-key',
        value: sign(
          null,
          Buffer.from(canonicalJson(manifest)),
          privateKey
        ).toString('base64')
      }
    },
    files: [{ path: 'module.json', base64: bytes.toString('base64') }]
  })
}
try {
  let host = new AddonHost(root, policy),
    commands = createAddonCommands(host)
  host.setBinding({
    accountHandle: 'synthetic-account',
    guildHandle: 'synthetic-guild'
  })
  const digests = []
  for (const id of ['guild-war', 'replays']) {
    const staged = await commands.stagePackage(bundle(id, '1.0.0'))
    await commands.activate(staged.digest, staged.manifest.capabilities)
    digests.push({ addonId: id, packageSha256: staged.digest })
  }
  await commands.importLocalData(
    'guild-war',
    JSON.stringify({
      schemaVersion: 1,
      format: 'ta-war-summary-v1',
      season: 1,
      battles: [
        {
          battle: 1,
          attackerSlot: 1,
          zone: 1,
          points: 250,
          outcome: 'victory',
          occurredAt: 100
        }
      ]
    })
  )
  await commands.importLocalData(
    'replays',
    JSON.stringify({
      schemaVersion: 1,
      format: 'ta-replay-timeline-v1',
      durationMs: 1000,
      events: [
        {
          type: 'spawn',
          at: 0,
          entity: 1,
          side: 'allies',
          x: 1,
          y: 1,
          hp: 100
        },
        { type: 'damage', at: 500, entity: 1, amount: 20 }
      ]
    })
  )
  assert.equal((await commands.view('guild-war')).report.points, 250)
  assert.equal(
    replayFrame((await commands.view('replays')).replay, 500).entities[0].hp,
    80
  )
  const update = await commands.stagePackage(bundle('guild-war', '1.1.0'))
  policy.beforeCommit = () => {
    throw new Error('synthetic failed activation')
  }
  await assert.rejects(
    commands.activate(update.digest, update.manifest.capabilities),
    /update-failed/
  )
  delete policy.beforeCommit
  assert.equal(
    (await commands.list()).find((module) => module.addonId === 'guild-war')
      .version,
    '1.0.0'
  )
  await commands.activate(update.digest, update.manifest.capabilities)
  await commands.rollback('guild-war')
  await commands.setEnabled('guild-war', false)
  await assert.rejects(commands.view('guild-war'), /addon-disabled/)
  await commands.setEnabled('guild-war', true)
  host = new AddonHost(root, policy)
  host.setBinding({
    accountHandle: 'synthetic-account',
    guildHandle: 'synthetic-guild'
  })
  commands = createAddonCommands(host)
  assert.equal((await commands.view('guild-war')).report.points, 250)
  await commands.uninstall('guild-war', 'retain')
  const reinstall = await commands.stagePackage(bundle('guild-war', '1.0.0'))
  await commands.activate(reinstall.digest, reinstall.manifest.capabilities)
  assert.equal((await commands.view('guild-war')).report.points, 250)
  await commands.uninstall('guild-war', 'delete')
  assert.equal((await commands.view('replays')).replay.durationMs, 1000)
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      sourceSha: componentManifest.sourceSha,
      sourceDirty: componentManifest.sourceDirty,
      runtime: process.version,
      platform: process.platform,
      architecture: process.arch,
      evidenceKind: 'built-component-integration',
      nativeInstalledArtifact: false,
      signing: 'ephemeral-synthetic-test-key',
      cases: [
        'signed-install',
        'offline-war-report',
        'offline-replay-seek',
        'failed-update-retention',
        'rollback',
        'disable-enable',
        'restart',
        'uninstall-retain',
        'uninstall-delete-isolation'
      ],
      packages: digests,
      components: componentManifest.components
    }) + '\n'
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
