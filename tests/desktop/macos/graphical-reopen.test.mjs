import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  chmod
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { qualifyGraphicalReopen } from '../../../apps/desktop/platform/macos/graphical-reopen.mjs'

const refused = { code: 'EGRAPHICALPROOF' }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64'
)
async function fixture(t) {
  const working = await mkdtemp(join(tmpdir(), 'synthetic graphical reopen '))
  t.after(() => rm(working, { recursive: true, force: true }))
  const state = join(working, 'workspace')
  await mkdir(state, { mode: 0o700 })
  const verifyFile = join(working, 'verify.json')
  const binding = {
    sourceCommit: 'a'.repeat(40),
    artifactSha256: 'b'.repeat(64),
    inventorySha256: 'c'.repeat(64),
    architecture: 'arm64',
    sourceHashes: {
      'apps/desktop/platform/macos/qualification.mjs': 'd'.repeat(64),
      'apps/desktop/platform/macos/graphical-reopen.mjs': 'e'.repeat(64)
    }
  }
  const config = {
    synthetic: true,
    sourceCommit: binding.sourceCommit,
    artifactSha256: binding.artifactSha256,
    deviceEvidence: join(working, 'device-session.json'),
    evidence: join(working, 'renderer.json'),
    screenshot: join(working, 'renderer.png'),
    networkPolicy: '(version 1)(allow default)(deny network*)',
    externalAddress: '192.0.2.1'
  }
  await writeFile(verifyFile, JSON.stringify(config), { mode: 0o600 })
  return { working, state, verifyFile, binding, config }
}
function device(f, launch) {
  return {
    synthetic: true,
    realBundledAuth: true,
    freshPasswordFreeHolding: launch === 1,
    formerPasswordOwnerPreserved: launch === 1,
    nativeAutomaticSession: true,
    transportOnlyBootstrapRefused: true,
    externalBootstrapRefused: true,
    forgedSessionRefused: true,
    localDataPreserved: true,
    syntheticDataDigest: String(launch).repeat(64),
    postJourneyDataDigest: String(launch + 1).repeat(64),
    keychainBindings: 'unqualified-owner-provisioning-required',
    sourceCommit: f.binding.sourceCommit,
    artifactSha256: f.binding.artifactSha256
  }
}
function renderer() {
  return {
    observed: {
      nodeAccess: false,
      positiveScore: true,
      negativeScore: true,
      serviceDisruption: false
    },
    network: { pending: [], failed: [], blocked: 0 },
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nativeSessionVerified: true,
    deviceSession: true,
    signedOutRecovery: true,
    rendererBootstrapRefused: true,
    electronExternalRefused: true
  }
}
// The callback writes real files; it never launches a native process or proves
// an installed journey. Qualification keeps that authority in its run callback.
function writer(f, change = () => {}) {
  let launch = 0
  return async (args, options) => {
    launch++
    assert.deepEqual(args, [])
    const config = JSON.parse(await readFile(options.verifyFile))
    const receipts = { device: device(f, launch), renderer: renderer(), png }
    await change(receipts, launch, config)
    await writeFile(config.deviceEvidence, JSON.stringify(receipts.device), {
      mode: 0o600
    })
    await writeFile(config.evidence, JSON.stringify(receipts.renderer), {
      mode: 0o600
    })
    await writeFile(config.screenshot, receipts.png, { mode: 0o600 })
  }
}
async function noPass(f) {
  assert.equal(
    (await readdir(f.working)).includes('graphical-reopen.json'),
    false
  )
}
async function failure(f) {
  return JSON.parse(
    await readFile(join(f.working, 'graphical-reopen-failure.json'))
  )
}

test('mandatory graphical qualification awaits two installed launches in the same workspace', async (t) => {
  const f = await fixture(t)
  const calls = []
  const write = writer(f)
  let releaseFirst
  let firstStarted
  const started = new Promise((resolve) => {
    firstStarted = resolve
  })
  const latch = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const pending = qualifyGraphicalReopen({
    ...f,
    run: async (args, options) => {
      calls.push({ args, options })
      if (calls.length === 1) {
        firstStarted()
        await latch
      }
      await write(args, options)
    }
  })
  await started
  assert.equal(calls.length, 1)
  await noPass(f)
  releaseFirst()
  const result = await pending
  assert.equal(calls.length, 2)
  assert.deepEqual(
    calls.map((call) => call.options.stateDirectory),
    [f.state, f.state]
  )
  assert.equal(calls[0].options.verifyFile, f.verifyFile)
  assert.equal(
    calls[1].options.verifyFile,
    join(f.working, 'graphical-reopen-verify.json')
  )
  const second = JSON.parse(await readFile(calls[1].options.verifyFile))
  assert.deepEqual(second, {
    ...f.config,
    deviceEvidence: join(f.working, 'graphical-reopen-device-session.json'),
    evidence: join(f.working, 'graphical-reopen-renderer.json'),
    screenshot: join(f.working, 'graphical-reopen-renderer.png')
  })
  assert.deepEqual(JSON.parse(await readFile(f.verifyFile)), f.config)
  assert.equal(result.sourceCommit, f.binding.sourceCommit)
  assert.equal(result.artifactSha256, f.binding.artifactSha256)
  assert.equal(result.inventorySha256, f.binding.inventorySha256)
  assert.deepEqual(result.sourceHashes, f.binding.sourceHashes)
  assert.equal(result.architecture, 'arm64')
  assert.equal(result.sameWorkspace, true)
  assert.equal(result.crossLaunchDataPreserved, true)
  assert.equal(result.runtimeSupervisorConfinement, 'not-established')
  for (const [index, config] of [f.config, second].entries()) {
    const record = result.launches[index]
    assert.equal(record.launch, index + 1)
    assert.equal(record.nativeCompleted, true)
    assert.equal(record.beforeJourneyDataDigest, String(index + 1).repeat(64))
    assert.equal(record.afterJourneyDataDigest, String(index + 2).repeat(64))
    assert.equal(
      record.deviceSHA256,
      sha(await readFile(config.deviceEvidence))
    )
    assert.equal(record.rendererSHA256, sha(await readFile(config.evidence)))
    assert.equal(
      record.screenshotSHA256,
      sha(await readFile(config.screenshot))
    )
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(f.working, 'graphical-reopen.json'))),
    result
  )
  assert.equal(JSON.stringify(result).includes(f.working), false)
  assert.equal(JSON.stringify(result).includes(f.config.externalAddress), false)
})

for (const failedLaunch of [1, 2]) {
  test(`launch ${failedLaunch} failure stays primary even after receipt files were produced`, async (t) => {
    const f = await fixture(t)
    const original = new Error('synthetic launch refusal')
    const write = writer(f)
    let calls = 0
    await assert.rejects(
      qualifyGraphicalReopen({
        ...f,
        run: async (...args) => {
          await write(...args)
          if (++calls === failedLaunch) throw original
        }
      }),
      (error) => error === original
    )
    assert.equal(calls, failedLaunch)
    await noPass(f)
    assert.equal((await failure(f)).failedLaunch, failedLaunch)
    assert.equal((await failure(f)).stage, 'launch')
    assert.equal((await readFile(f.config.screenshot)).equals(png), true)
    assert.equal(
      JSON.stringify(await failure(f)).includes(original.message),
      false
    )
  })
}

test('receipt retention failure cannot replace the original launch failure', async (t) => {
  const f = await fixture(t)
  const original = new Error('synthetic original failure')
  await assert.rejects(
    qualifyGraphicalReopen({
      ...f,
      run: async () => {
        await mkdir(join(f.working, 'graphical-reopen-failure.json'))
        throw original
      }
    }),
    (error) => error === original
  )
  await noPass(f)
})

test('cross-launch mismatch refuses while retaining both completed evidence sets', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    qualifyGraphicalReopen({
      ...f,
      run: writer(f, (receipts, launch) => {
        if (launch === 2) receipts.device.syntheticDataDigest = 'f'.repeat(64)
      })
    }),
    refused
  )
  await noPass(f)
  assert.equal((await failure(f)).stage, 'data-continuity')
  assert.equal((await failure(f)).failedLaunch, 2)
  for (const name of ['renderer.json', 'graphical-reopen-renderer.json'])
    assert.equal(
      JSON.parse(await readFile(join(f.working, name))).sandbox,
      true
    )
})

for (const [name, change] of [
  [
    'wrong device source',
    (r) => {
      r.device.sourceCommit = 'f'.repeat(40)
    }
  ],
  [
    'wrong artifact',
    (r) => {
      r.device.artifactSha256 = 'f'.repeat(64)
    }
  ],
  [
    'invalid digest',
    (r) => {
      r.device.postJourneyDataDigest = 'not-a-digest'
    }
  ],
  [
    'fresh setup on reopen',
    (r) => {
      r.device.freshPasswordFreeHolding = true
    }
  ],
  [
    'former owner setup on reopen',
    (r) => {
      r.device.formerPasswordOwnerPreserved = true
    }
  ],
  [
    'missing native session',
    (r) => {
      r.device.nativeAutomaticSession = false
    }
  ],
  [
    'unknown device field',
    (r) => {
      r.device.extra = 'SYNTHETIC-PRIVATE-CANARY'
    }
  ],
  [
    'nonboolean sandbox',
    (r) => {
      r.renderer.sandbox = 1
    }
  ],
  [
    'missing signed-out recovery',
    (r) => {
      r.renderer.signedOutRecovery = false
    }
  ],
  [
    'unsafe node access',
    (r) => {
      r.renderer.observed.nodeAccess = true
    }
  ],
  [
    'incorrect scores',
    (r) => {
      r.renderer.observed.positiveScore = false
    }
  ],
  [
    'service disruption',
    (r) => {
      r.renderer.observed.serviceDisruption = true
    }
  ],
  [
    'pending request',
    (r) => {
      r.renderer.network.pending = [{}]
    }
  ],
  [
    'blocked request',
    (r) => {
      r.renderer.network.blocked = 1
    }
  ],
  [
    'unexpected status',
    (r) => {
      r.renderer.network.failed = [
        {
          endpoint: 'scores-page',
          resource: 'xhr',
          status: 500,
          phase: 'scores-view'
        }
      ]
    }
  ],
  [
    'unknown renderer field',
    (r) => {
      r.renderer.extra = true
    }
  ],
  [
    'invalid PNG',
    (r) => {
      r.png = Buffer.from('not a PNG')
    }
  ]
]) {
  test(`${name} cannot qualify the second launch`, async (t) => {
    const f = await fixture(t)
    await assert.rejects(
      qualifyGraphicalReopen({
        ...f,
        run: writer(f, (r, launch) => {
          if (launch === 2) change(r)
        })
      }),
      refused
    )
    await noPass(f)
  })
}

for (const phase of [
  'initial-open',
  'recovered-open',
  'scores-view',
  undefined
]) {
  test(`401 outside signed-out request-start phase ${phase} refuses`, async (t) => {
    const f = await fixture(t)
    await assert.rejects(
      qualifyGraphicalReopen({
        ...f,
        run: writer(f, (r) => {
          r.renderer.network.failed = [
            {
              endpoint: 'auth-user',
              resource: 'xhr',
              status: 401,
              ...(phase ? { phase } : {})
            }
          ]
        })
      }),
      refused
    )
    await noPass(f)
  })
}
test('deliberate signed-out 401 and existing expected 403 endpoints remain admitted', async (t) => {
  const f = await fixture(t)
  await qualifyGraphicalReopen({
    ...f,
    run: writer(f, (r) => {
      r.renderer.network.failed = [
        {
          endpoint: 'auth-user',
          resource: 'xhr',
          status: 401,
          phase: 'signed-out-check'
        },
        {
          endpoint: 'device-bootstrap',
          resource: 'mainFrame',
          status: 403,
          phase: 'renderer-refusal'
        },
        {
          endpoint: 'guild-tokens',
          resource: 'xhr',
          status: 403,
          phase: 'scores-view'
        }
      ]
    })
  })
})

for (const name of [
  'graphical-reopen-verify.json',
  'graphical-reopen-renderer.json',
  'device-session.json',
  'graphical-reopen.json'
]) {
  test(`preexisting ${name} refuses before any launch`, async (t) => {
    const f = await fixture(t)
    const path = join(f.working, name)
    await writeFile(path, 'SYNTHETIC-EXISTING', { mode: 0o600 })
    let calls = 0
    await assert.rejects(
      qualifyGraphicalReopen({
        ...f,
        run: async () => {
          calls++
        }
      }),
      refused
    )
    assert.equal(calls, 0)
    assert.equal(await readFile(path, 'utf8'), 'SYNTHETIC-EXISTING')
  })
}
for (const kind of [
  'invalid-json',
  'invalid-utf8',
  'oversized',
  'symlink',
  'nonprivate',
  'directory'
]) {
  test(`${kind} device evidence refuses without following or trusting it`, async (t) => {
    const f = await fixture(t)
    const write = writer(f)
    await assert.rejects(
      qualifyGraphicalReopen({
        ...f,
        run: async (...args) => {
          await write(...args)
          if (kind === 'invalid-json')
            await writeFile(f.config.deviceEvidence, '{')
          if (kind === 'invalid-utf8')
            await writeFile(f.config.deviceEvidence, Buffer.from([0xff]))
          if (kind === 'oversized')
            await writeFile(f.config.deviceEvidence, Buffer.alloc(1048577))
          if (kind === 'nonprivate') await chmod(f.config.deviceEvidence, 0o644)
          if (kind === 'directory') {
            await rm(f.config.deviceEvidence)
            await mkdir(f.config.deviceEvidence, { mode: 0o700 })
          }
          if (kind === 'symlink') {
            const target = join(f.working, 'synthetic-private.json')
            await writeFile(target, 'SYNTHETIC-PRIVATE-CANARY', { mode: 0o600 })
            await rm(f.config.deviceEvidence)
            await symlink(target, f.config.deviceEvidence)
          }
        }
      }),
      refused
    )
    await noPass(f)
    assert.equal(
      JSON.stringify(await failure(f)).includes('SYNTHETIC-PRIVATE-CANARY'),
      false
    )
  })
}
for (const [name, change] of [
  [
    'unknown architecture',
    (f) => {
      f.binding.architecture = 'other'
    }
  ],
  [
    'invalid source hash',
    (f) => {
      f.binding.sourceHashes[
        'apps/desktop/platform/macos/graphical-reopen.mjs'
      ] = 'invalid'
    }
  ],
  [
    'different state',
    (f) => {
      f.state = join(f.working, 'other')
    }
  ]
]) {
  test(`${name} refuses before any launch or failure attachment`, async (t) => {
    const f = await fixture(t)
    change(f)
    let calls = 0
    await assert.rejects(
      qualifyGraphicalReopen({
        ...f,
        run: async () => {
          calls++
        }
      }),
      refused
    )
    assert.equal(calls, 0)
    assert.equal(
      (await readdir(f.working)).includes('graphical-reopen-failure.json'),
      false
    )
  })
}
