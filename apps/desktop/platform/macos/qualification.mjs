import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { lookup } from 'node:dns/promises'
import { stage, inventory } from './stage.mjs'
import { records } from './evidence.mjs'
import requestDiagnostics from './request-diagnostics.cjs'

const inputs = resolve(process.argv[2]),
  application = resolve(process.argv[3]),
  native = resolve(process.argv[4]),
  output = process.argv[5]
if (process.platform !== 'darwin')
  throw new Error('Actual native macOS required')
if (!isAbsolute(output ?? ''))
  throw new Error('Absolute synthetic evidence output required')
await mkdir(output, { recursive: false, mode: 0o700 })
const working = await mkdtemp(join(tmpdir(), 'ta mac package ü '))
const startedAt = new Date().toISOString()
const imageRoot = join(working, 'image'),
  app = join(imageRoot, 'Tacticus Analytics Preview.app')
await mkdir(imageRoot)
await stage({
  output: app,
  sourceCommit: process.env.MAC_SOURCE_SHA,
  architecture: process.arch,
  application,
  postgres: join(inputs, 'postgres'),
  node: join(inputs, 'node/bin/node'),
  electron: join(inputs, 'electron'),
  auth: join(inputs, 'auth'),
  postgrest: join(inputs, 'postgrest/postgrest'),
  guard: join(native, 'owner-guard'),
  vault: join(native, 'secret-vault')
})
const dmg = join(working, 'candidate.dmg')
execFileSync(
  '/usr/bin/hdiutil',
  [
    'create',
    '-srcfolder',
    imageRoot,
    '-volname',
    'Tacticus Analytics Preview',
    '-format',
    'UDZO',
    dmg
  ],
  { stdio: 'pipe' }
)
const digest = createHash('sha256')
  .update(await readFile(dmg))
  .digest('hex')
await cp(dmg, join(output, 'candidate.dmg'))
await cp(
  join(app, 'Contents/Resources/package-inventory.json'),
  join(output, 'package-inventory.json')
)
await writeFile(
  join(output, 'artifact.json'),
  JSON.stringify({
    sourceCommit: process.env.MAC_SOURCE_SHA,
    artifactSha256: digest,
    architecture: process.arch,
    classification: 'vm',
    qualification: 'unqualified-until-evidence-passes'
  }),
  { mode: 0o600 }
)
const mount = join(working, 'mount'),
  installed = join(
    working,
    'Applications with spaces ü/Tacticus Analytics Preview.app'
  )
await mkdir(mount)
execFileSync(
  '/usr/bin/hdiutil',
  ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg],
  { stdio: 'pipe' }
)
try {
  await cp(join(mount, 'Tacticus Analytics Preview.app'), installed, {
    recursive: true,
    verbatimSymlinks: true
  })
} finally {
  execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'pipe' })
}
const runtime = join(installed, 'Contents/Resources/runtime'),
  state = join(working, 'workspace')
await mkdir(state, { mode: 0o700 })
const verify = join(working, 'verify.json'),
  storageVerify = join(working, 'storage-verify.json')
const config = {
  synthetic: true,
  sourceCommit: process.env.MAC_SOURCE_SHA,
  artifactSha256: digest,
  deviceEvidence: join(working, 'device-session.json'),
  evidence: join(working, 'renderer.json'),
  screenshot: join(working, 'renderer.png')
}
await writeFile(storageVerify, JSON.stringify(config), { mode: 0o600 })
// Storage launches run the full installed descendant tree under this policy.
// The graphical launch confines every service with it but keeps Electron
// outside, because Chromium cannot initialize its own sandbox inside another
// Seatbelt profile; Electron proves its refusal of external requests itself.
// This policy is a qualification tool, not a weakened consumer OS protection.
const policy =
  '(version 1)(allow default)(deny network*)(allow network* (local unix-socket))(allow network* (remote unix-socket))(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))'
// Resolve a public target before sandboxing, then exercise the installed Node
// under the identical descendant policy. Neither target nor raw errors enter
// the synthetic receipt. Success requires an actual OS permission refusal.
let networkReceipt
let dnsDeadline
try {
  const target = await Promise.race([
    lookup('example.com', { family: 4 }),
    new Promise((_accept, reject) => {
      dnsDeadline = setTimeout(
        () => reject(new Error('Qualification DNS timed out')),
        5000
      )
    })
  ])
  clearTimeout(dnsDeadline)
  await writeFile(
    verify,
    JSON.stringify({
      ...config,
      networkPolicy: policy,
      externalAddress: target.address
    }),
    { mode: 0o600 }
  )
  networkReceipt = execFileSync(
    '/usr/bin/sandbox-exec',
    [
      '-p',
      policy,
      join(runtime, 'bin/node'),
      join(runtime, 'apps/desktop/platform/macos/network-isolation.mjs'),
      target.address
    ],
    {
      env: { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR },
      encoding: 'utf8',
      timeout: 15000
    }
  )
} catch {
  await writeFile(
    join(output, 'network-policy.json'),
    JSON.stringify({ synthetic: true, result: 'not-established' }),
    { mode: 0o600 }
  )
  throw new Error('Installed local IPC and external TCP policy proof failed')
} finally {
  clearTimeout(dnsDeadline)
}
const networkResult = JSON.parse(networkReceipt)
if (
  networkResult.synthetic !== true ||
  networkResult.localUnixIPC !== true ||
  networkResult.nonLoopbackTCPDenied !== true
)
  throw new Error('Installed network policy qualification failed')
await writeFile(
  join(working, 'network-policy.json'),
  JSON.stringify(networkResult),
  { mode: 0o600 }
)
await cp(
  join(working, 'network-policy.json'),
  join(output, 'network-policy.json')
)
async function run(
  arguments_,
  { wholeTreePolicy = false, stateDirectory = state, verifyFile = verify } = {}
) {
  const executable = join(installed, 'Contents/MacOS/TacticusAnalytics')
  const child = spawn(
    wholeTreePolicy ? '/usr/bin/sandbox-exec' : executable,
    [
      ...(wholeTreePolicy ? ['-p', policy, executable] : []),
      '--run',
      join(stateDirectory, 'owner.lock'),
      join(runtime, 'bin/node'),
      join(runtime, 'apps/desktop/platform/macos/runtime.mjs'),
      '--verify',
      verifyFile,
      ...arguments_
    ],
    {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR
      },
      stdio: 'inherit'
    }
  )
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, 180000)
  try {
    const code = await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('exit', accept)
    })
    if (code !== 0 || timedOut)
      throw new Error('Installed developer package journey failed')
  } finally {
    clearTimeout(deadline)
  }
}
let failedPhase = 'graphical'
try {
  await run([])
  failedPhase = 'storage'
  for (const name of ['storage-first.json', 'storage-second.json'])
    await run(['--storage-check', join(working, name)], {
      wholeTreePolicy: true,
      verifyFile: storageVerify
    })
} catch (error) {
  for (const name of [
    'device-session.json',
    'renderer.json',
    'renderer.json.failure.json',
    'renderer.json.native.json',
    'renderer.png',
    'storage-first.json',
    'storage-second.json'
  ]) {
    try {
      await cp(join(working, name), join(output, name))
    } catch (copyError) {
      if (copyError.code !== 'ENOENT') throw copyError
    }
  }
  // Diagnose ordinary runtime compatibility separately. The mandatory network
  // isolation failure above remains the final outcome. Never emit platform
  // acceptance from this probe or change Electron's own sandbox settings.
  let nativeFailure
  try {
    nativeFailure = JSON.parse(
      await readFile(join(working, 'renderer.json.native.json'))
    )
  } catch {}
  try {
    if (
      failedPhase === 'graphical' &&
      nativeFailure?.synthetic === true &&
      Array.isArray(nativeFailure.categories) &&
      nativeFailure.categories.includes('sandbox-initialization') &&
      ((Number.isSafeInteger(nativeFailure.exitCode) &&
        nativeFailure.exitCode !== 0) ||
        /^SIG[A-Z]+$/.test(nativeFailure.signal ?? ''))
    ) {
      const probe = {
        synthetic: true,
        sourceCommit: process.env.MAC_SOURCE_SHA,
        artifactSha256: digest,
        kind: 'ordinary-runtime-compatibility-probe',
        mandatoryOfflineQualification: 'failed',
        networkIsolation: 'not-established',
        consumerKeychainBindings: 'unqualified',
        result: 'failed',
        runs: []
      }
      const probeState = join(working, 'compatibility-workspace')
      await mkdir(probeState, { mode: 0o700 })
      let activeProbeConfig
      try {
        for (let index = 1; index <= 2; index++) {
          const prefix = 'compatibility-' + index
          // Outside the policy entirely: neither the services nor Electron.
          const probeConfig = {
            ...config,
            deviceEvidence: join(working, prefix + '-device.json'),
            evidence: join(working, prefix + '-renderer.json'),
            screenshot: join(working, prefix + '.png')
          }
          activeProbeConfig = probeConfig
          const probeVerify = join(working, prefix + '-verify.json')
          await writeFile(probeVerify, JSON.stringify(probeConfig), {
            mode: 0o600
          })
          await run([], {
            stateDirectory: probeState,
            verifyFile: probeVerify
          })
          // Process success is required because renderer output is captured
          // before the final calculation and request assertions.
          const renderer = JSON.parse(await readFile(probeConfig.evidence))
          const device = JSON.parse(await readFile(probeConfig.deviceEvidence))
          if (
            renderer.sandbox !== true ||
            renderer.contextIsolation !== true ||
            renderer.nodeIntegration !== false ||
            renderer.nativeSessionVerified !== true ||
            renderer.deviceSession !== true ||
            renderer.signedOutRecovery !== true ||
            renderer.rendererBootstrapRefused !== true ||
            renderer.observed?.nodeAccess !== false ||
            renderer.observed?.positiveScore !== true ||
            renderer.observed?.negativeScore !== true ||
            renderer.observed?.serviceDisruption !== false ||
            device.sourceCommit !== process.env.MAC_SOURCE_SHA ||
            device.artifactSha256 !== digest ||
            device.localDataPreserved !== true ||
            !/^[a-f0-9]{64}$/.test(device.syntheticDataDigest ?? '') ||
            !/^[a-f0-9]{64}$/.test(device.postJourneyDataDigest ?? '')
          )
            throw new Error('Compatibility probe assertions failed')
          probe.runs.push({
            launch: index,
            guardedJourney: 'passed',
            electronSandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            nativeOwnerSession: true,
            signedOutRecovery: true,
            actualRendererBootstrapRefused: true,
            beforeJourneyDataDigest: device.syntheticDataDigest,
            afterJourneyDataDigest: device.postJourneyDataDigest
          })
          await cp(probeConfig.screenshot, join(output, prefix + '.png'))
        }
        if (
          probe.runs[0].afterJourneyDataDigest !==
          probe.runs[1].beforeJourneyDataDigest
        )
          throw new Error(
            'Compatibility restart did not preserve synthetic data'
          )
        probe.result = 'passed'
        probe.syntheticRestartDataPreserved = true
      } catch {
        // The synthetic screenshot and boolean renderer receipt are written
        // before the final score assertion, so a failed run keeps both.
        for (const [from, to] of [
          [activeProbeConfig?.screenshot, '.png'],
          [activeProbeConfig?.evidence, '-renderer.json']
        ])
          try {
            await cp(from, join(output, 'compatibility-failed' + to))
          } catch {}
        // Keep only a fixed failure classification. Raw renderer content, URLs,
        // credentials, workspace files and environment never enter this receipt.
        probe.result = 'failed'
        probe.failure = { stage: 'unknown', code: 'EVERIFY', categories: [] }
        try {
          const failure = JSON.parse(
            await readFile(activeProbeConfig.evidence + '.failure.json')
          )
          if (
            [
              'window-startup',
              'workspace-page',
              'workspace-setup',
              'workspace-navigation',
              'native-session',
              'renderer-observation',
              'renderer-scores',
              'renderer-network'
            ].includes(failure.stage)
          )
            probe.failure.stage = failure.stage
          if (
            [
              'ESESSION',
              'EVAULT',
              'EVAULTLOCKED',
              'EACCESS',
              'EVERIFY'
            ].includes(failure.code)
          )
            probe.failure.code = failure.code
          const bounded = requestDiagnostics.sanitizeFailure(failure)
          if (bounded.cause) {
            probe.failure.cause = bounded.cause
            probe.failure.network = bounded.network
          }
        } catch {}
        try {
          const failure = JSON.parse(
            await readFile(activeProbeConfig.evidence + '.native.json')
          )
          const allowed = [
            'code-signature',
            'dynamic-loader',
            'window-server',
            'module-loading',
            'os-permission',
            'sandbox-initialization',
            'sandbox-policy-apply',
            'sandbox-policy-setup',
            'sandbox-policy-compile',
            'gpu-process',
            'native-ipc',
            'loopback-load',
            'node-environment'
          ]
          if (Array.isArray(failure.categories))
            probe.failure.categories = [
              ...new Set(
                failure.categories.filter((value) => allowed.includes(value))
              )
            ].sort()
        } catch {}
      }
      await writeFile(
        join(output, 'compatibility-probe.json'),
        JSON.stringify(probe),
        { mode: 0o600 }
      )
    }
  } catch {
    // Supplemental evidence failures never replace the mandatory outcome.
  }
  throw error
}
const first = JSON.parse(await readFile(join(working, 'storage-first.json'))),
  second = JSON.parse(await readFile(join(working, 'storage-second.json')))
if (first.counter !== 1 || second.counter !== 2)
  throw new Error('Restart did not retain installed writes')
const files = await inventory(installed)
const attachments = []
for (const [name, mediaType] of [
  ['device-session.json', 'application/json'],
  ['network-policy.json', 'application/json'],
  ['renderer.json', 'application/json'],
  ['renderer.png', 'image/png'],
  ['storage-first.json', 'application/json'],
  ['storage-second.json', 'application/json']
]) {
  attachments.push({
    name,
    mediaType,
    redacted: true,
    sha256: createHash('sha256')
      .update(await readFile(join(working, name)))
      .digest('hex')
  })
}
const evidence = records({
  sha: process.env.MAC_SOURCE_SHA,
  artifactSha256: digest,
  osVersion: execFileSync('/usr/bin/sw_vers', ['-productVersion'], {
    encoding: 'utf8'
  }).trim(),
  arch: process.arch,
  runtimeVersions: {
    node: '22.23.3',
    electron: '44.5.1',
    postgres: '18.6',
    auth: '2.197.0',
    postgrest: '16.4'
  },
  fixtureSha256: createHash('sha256')
    .update(
      await readFile(join(runtime, 'apps/desktop/proof/synthetic-import.mjs'))
    )
    .digest('hex'),
  startedAt,
  completedAt: new Date().toISOString(),
  attachments
})
await writeFile(
  join(working, 'platform-evidence.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
for (const record of evidence)
  console.log('TA-PLATFORM-EVIDENCE:' + JSON.stringify(record))
// Retain only the inventoried candidate and selected synthetic attachments;
// workspace credentials, browser storage and vault state are never uploaded.
for (const name of [
  'platform-evidence.json',
  ...attachments.map((attachment) => attachment.name)
])
  await cp(join(working, name), join(output, name))
await cp(
  join(installed, 'Contents/Resources/package-inventory.json'),
  join(output, 'package-inventory.json')
)
console.log(
  JSON.stringify({
    schemaVersion: 1,
    sourceCommit: process.env.MAC_SOURCE_SHA,
    artifactSha256: digest,
    format: 'dmg',
    architecture: process.arch,
    classification: 'vm',
    installation: 'unsigned-developer-copy-from-mounted-image',
    files: files.length,
    offlineRenderer: 'selected-analytics-pass',
    restart: 'pass',
    databaseBackupRestore: 'pass',
    badMigrationRollback: 'pass',
    signature: 'pending-owner-identity',
    notarization: 'pending',
    physical: 'unqualified',
    fullParity: 'unqualified'
  })
)
