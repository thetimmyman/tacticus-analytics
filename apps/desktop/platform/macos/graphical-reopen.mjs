import { constants } from 'node:fs'
import { lstat, open, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, isAbsolute } from 'node:path'

const refuse = () =>
  Object.assign(new Error('Installed graphical reopen proof refused'), {
    code: 'EGRAPHICALPROOF'
  })
const requireProof = (value) => {
  if (!value) throw refuse()
}
const sha = (value) => createHash('sha256').update(value).digest('hex')
const hex = (value, length = 64) =>
  typeof value === 'string' &&
  new RegExp('^[a-f0-9]{' + length + '}$').test(value)
const keys = (value, expected) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...expected].sort().join(',')
const sourcePaths = [
  'apps/desktop/platform/macos/qualification.mjs',
  'apps/desktop/platform/macos/graphical-reopen.mjs'
]

async function privateDirectory(path) {
  const info = await lstat(path)
  requireProof(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid() &&
      !(info.mode & 0o077)
  )
}
async function absent(path) {
  try {
    await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw refuse()
}
async function boundedFile(path, limit) {
  const before = await lstat(path, { bigint: true })
  requireProof(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.uid === BigInt(process.getuid()) &&
      !(before.mode & 0o077n) &&
      before.size <= BigInt(limit)
  )
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const opened = await file.stat({ bigint: true })
    requireProof(opened.dev === before.dev && opened.ino === before.ino)
    const buffer = Buffer.alloc(limit + 1)
    let bytes = 0
    for (;;) {
      const read = await file.read(buffer, bytes, buffer.length - bytes, null)
      bytes += read.bytesRead
      requireProof(bytes <= limit)
      if (!read.bytesRead) break
    }
    const after = await file.stat({ bigint: true })
    const current = await lstat(path, { bigint: true })
    requireProof(
      after.dev === before.dev &&
        after.ino === before.ino &&
        after.size === BigInt(bytes) &&
        after.size === before.size &&
        after.mtimeNs === before.mtimeNs &&
        current.dev === before.dev &&
        current.ino === before.ino &&
        !current.isSymbolicLink()
    )
    return buffer.subarray(0, bytes)
  } finally {
    await file.close()
  }
}
function decode(bytes) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw refuse()
  }
}
function validateRenderer(renderer) {
  requireProof(
    keys(renderer, [
      'observed',
      'network',
      'sandbox',
      'contextIsolation',
      'nodeIntegration',
      'nativeSessionVerified',
      'deviceSession',
      'signedOutRecovery',
      'rendererBootstrapRefused',
      'electronExternalRefused'
    ]) &&
      keys(renderer.observed, [
        'nodeAccess',
        'positiveScore',
        'negativeScore',
        'serviceDisruption'
      ]) &&
      keys(renderer.network, ['pending', 'failed', 'blocked']) &&
      [
        'sandbox',
        'contextIsolation',
        'nativeSessionVerified',
        'deviceSession',
        'signedOutRecovery',
        'rendererBootstrapRefused',
        'electronExternalRefused'
      ].every((key) => renderer[key] === true) &&
      renderer.nodeIntegration === false &&
      renderer.observed.nodeAccess === false &&
      renderer.observed.positiveScore === true &&
      renderer.observed.negativeScore === true &&
      renderer.observed.serviceDisruption === false &&
      Array.isArray(renderer.network.pending) &&
      renderer.network.pending.length === 0 &&
      renderer.network.blocked === 0 &&
      Array.isArray(renderer.network.failed) &&
      renderer.network.failed.length <= 20
  )
  for (const failure of renderer.network.failed) {
    requireProof(
      keys(failure, [
        'endpoint',
        'resource',
        'status',
        ...(Object.hasOwn(failure ?? {}, 'phase') ? ['phase'] : [])
      ]) &&
        typeof failure.endpoint === 'string' &&
        /^[a-z-]{1,64}$/.test(failure.endpoint) &&
        typeof failure.resource === 'string' &&
        /^[A-Za-z]{1,32}$/.test(failure.resource) &&
        ((failure.status === 401 && failure.phase === 'signed-out-check') ||
          (failure.status === 403 &&
            ['device-bootstrap', 'guild-tokens'].includes(failure.endpoint)))
    )
  }
}
function validateDevice(device, binding, launch) {
  requireProof(
    keys(device, [
      'synthetic',
      'realBundledAuth',
      'freshPasswordFreeHolding',
      'formerPasswordOwnerPreserved',
      'nativeAutomaticSession',
      'transportOnlyBootstrapRefused',
      'externalBootstrapRefused',
      'forgedSessionRefused',
      'localDataPreserved',
      'syntheticDataDigest',
      'postJourneyDataDigest',
      'keychainBindings',
      'sourceCommit',
      'artifactSha256'
    ]) &&
      [
        'synthetic',
        'realBundledAuth',
        'nativeAutomaticSession',
        'transportOnlyBootstrapRefused',
        'externalBootstrapRefused',
        'forgedSessionRefused',
        'localDataPreserved'
      ].every((key) => device[key] === true) &&
      device.freshPasswordFreeHolding === (launch === 1) &&
      device.formerPasswordOwnerPreserved === (launch === 1) &&
      device.sourceCommit === binding.sourceCommit &&
      device.artifactSha256 === binding.artifactSha256 &&
      device.keychainBindings === 'unqualified-owner-provisioning-required' &&
      hex(device.syntheticDataDigest) &&
      hex(device.postJourneyDataDigest)
  )
}

// run is the qualification's existing installed native owner launcher. It must
// resolve only after a zero exit, retaining its ownership, policy and deadline.
export async function qualifyGraphicalReopen({
  working,
  state,
  verifyFile,
  binding,
  run
}) {
  let launch = 1,
    stage = 'evidence',
    admitted = false
  try {
    requireProof(
      isAbsolute(working ?? '') &&
        state === join(working, 'workspace') &&
        verifyFile === join(working, 'verify.json') &&
        typeof run === 'function' &&
        keys(binding, [
          'sourceCommit',
          'artifactSha256',
          'inventorySha256',
          'architecture',
          'sourceHashes'
        ]) &&
        hex(binding.sourceCommit, 40) &&
        hex(binding.artifactSha256) &&
        hex(binding.inventorySha256) &&
        ['arm64', 'x64'].includes(binding.architecture) &&
        keys(binding.sourceHashes, sourcePaths) &&
        sourcePaths.every((path) => hex(binding.sourceHashes[path]))
    )
    await privateDirectory(working)
    await privateDirectory(state)
    admitted = true
    const config = decode(await boundedFile(verifyFile, 65536))
    requireProof(
      keys(config, [
        'synthetic',
        'sourceCommit',
        'artifactSha256',
        'deviceEvidence',
        'evidence',
        'screenshot',
        'networkPolicy',
        'externalAddress'
      ]) &&
        config.synthetic === true &&
        config.sourceCommit === binding.sourceCommit &&
        config.artifactSha256 === binding.artifactSha256 &&
        config.deviceEvidence === join(working, 'device-session.json') &&
        config.evidence === join(working, 'renderer.json') &&
        config.screenshot === join(working, 'renderer.png') &&
        typeof config.networkPolicy === 'string' &&
        config.networkPolicy.startsWith('(version 1)') &&
        config.networkPolicy.includes('(deny network*)') &&
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(config.externalAddress)
    )
    const second = {
      ...config,
      deviceEvidence: join(working, 'graphical-reopen-device-session.json'),
      evidence: join(working, 'graphical-reopen-renderer.json'),
      screenshot: join(working, 'graphical-reopen-renderer.png')
    }
    const secondVerify = join(working, 'graphical-reopen-verify.json')
    for (const path of [
      config.deviceEvidence,
      config.evidence,
      config.screenshot,
      second.deviceEvidence,
      second.evidence,
      second.screenshot,
      secondVerify,
      join(working, 'graphical-reopen.json'),
      join(working, 'graphical-reopen-failure.json')
    ])
      await absent(path)
    const launches = []
    for (const current of [config, second]) {
      const currentVerify = launch === 1 ? verifyFile : secondVerify
      if (launch === 2)
        await writeFile(currentVerify, JSON.stringify(current), {
          flag: 'wx',
          mode: 0o600
        })
      stage = 'launch'
      await run([], { stateDirectory: state, verifyFile: currentVerify })
      stage = 'device-receipt'
      const deviceBytes = await boundedFile(current.deviceEvidence, 1048576)
      const device = decode(deviceBytes)
      validateDevice(device, binding, launch)
      stage = 'renderer-receipt'
      const rendererBytes = await boundedFile(current.evidence, 1048576)
      validateRenderer(decode(rendererBytes))
      stage = 'evidence'
      const png = await boundedFile(current.screenshot, 16 * 1024 * 1024)
      requireProof(
        png.length >= 8 &&
          png
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
      launches.push({
        launch,
        nativeCompleted: true,
        beforeJourneyDataDigest: device.syntheticDataDigest,
        afterJourneyDataDigest: device.postJourneyDataDigest,
        deviceSHA256: sha(deviceBytes),
        rendererSHA256: sha(rendererBytes),
        screenshotSHA256: sha(png)
      })
      if (launch === 1) launch = 2
    }
    stage = 'data-continuity'
    requireProof(
      launches[0].afterJourneyDataDigest === launches[1].beforeJourneyDataDigest
    )
    const result = {
      schemaVersion: 1,
      synthetic: true,
      result: 'passed',
      ...binding,
      kind: 'mandatory-same-workspace-graphical-reopen',
      sameWorkspace: true,
      launches,
      crossLaunchDataPreserved: true,
      networkScope: 'existing-service-policy-plus-electron-refusal',
      runtimeSupervisorConfinement: 'not-established',
      scope:
        'Installed synthetic VM graphical reopen only; owning acceptance remains open.'
    }
    stage = 'evidence'
    await writeFile(
      join(working, 'graphical-reopen.json'),
      JSON.stringify(result),
      {
        flag: 'wx',
        mode: 0o600
      }
    )
    return result
  } catch (error) {
    if (admitted)
      try {
        await writeFile(
          join(working, 'graphical-reopen-failure.json'),
          JSON.stringify({
            schemaVersion: 1,
            synthetic: true,
            result: 'failed',
            ...binding,
            failedLaunch: launch,
            stage
          }),
          { flag: 'wx', mode: 0o600 }
        )
      } catch {
        // Retention cannot replace the original mandatory failure.
      }
    throw error
  }
}
