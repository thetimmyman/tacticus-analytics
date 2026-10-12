import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  readlink,
  rm
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  entitlements,
  listSigningTargets,
  runCli,
  sign,
  validateBundleId,
  validateTeamId,
  verify
} from '../../../apps/desktop/platform/macos/sign-release.mjs'

const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0])
const IDENTITY = 'Developer ID Application: Owner (ABCDE12345)'

test('lists Mach-O files deepest-first with the app bundle last', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign targets '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  await mkdir(join(app, 'Contents/MacOS'), { recursive: true })
  await mkdir(join(app, 'Contents/Resources/runtime/deep/nested'), {
    recursive: true
  })
  await writeFile(join(app, 'Contents/MacOS/main'), MACH_O)
  await writeFile(join(app, 'Contents/Resources/runtime/mid'), MACH_O)
  await writeFile(
    join(app, 'Contents/Resources/runtime/deep/nested/leaf'),
    MACH_O
  )
  await writeFile(join(app, 'Contents/Resources/readme.txt'), 'not a mach-o')
  const targets = await listSigningTargets(app)
  assert.equal(targets.at(-1), app)
  assert.deepEqual(targets.slice(0, -1), [
    join(app, 'Contents/Resources/runtime/deep/nested/leaf'),
    join(app, 'Contents/Resources/runtime/mid'),
    join(app, 'Contents/MacOS/main')
  ])
})

test('detects fat Mach-O magic as a signing target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign fat '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  await mkdir(join(app, 'Contents/MacOS'), { recursive: true })
  await writeFile(
    join(app, 'Contents/MacOS/fat'),
    Buffer.from([0xca, 0xfe, 0xba, 0xbe])
  )
  const targets = await listSigningTargets(app)
  assert.deepEqual(targets, [join(app, 'Contents/MacOS/fat'), app])
})

test('entitlements declare the keychain access group', () => {
  const text = entitlements({
    teamId: 'ABCDE12345',
    bundleId: 'com.example.desktop.preview'
  })
  assert.match(text, /keychain-access-groups/u)
  assert.match(
    text,
    /<string>ABCDE12345\.com\.example\.desktop\.preview<\/string>/u
  )
  assert.doesNotMatch(text, /allow-jit/u)
})

test('electron entitlements carry only the hardened-runtime JIT keys', () => {
  const text = entitlements({
    teamId: 'ABCDE12345',
    bundleId: 'com.example.desktop.preview',
    kind: 'electron'
  })
  assert.doesNotMatch(text, /keychain-access-groups/u)
  assert.match(text, /com\.apple\.security\.cs\.allow-jit/u)
  assert.match(
    text,
    /com\.apple\.security\.cs\.allow-unsigned-executable-memory/u
  )
})

test('node entitlements allow JIT only and unknown kinds are refused', () => {
  const base = { teamId: 'ABCDE12345', bundleId: 'com.example.desktop.preview' }
  const text = entitlements({ ...base, kind: 'jit' })
  assert.match(text, /allow-jit/u)
  assert.doesNotMatch(text, /unsigned-executable-memory|keychain/u)
  assert.throws(() => entitlements({ ...base, kind: 'all' }))
})

test('rejects injection-shaped team IDs and bundle IDs', () => {
  for (const value of [
    '',
    'ABC',
    'ABCDE123456',
    'ABCDE-1234',
    'TEAM.ID',
    'ABCDE1234 ',
    '; rm -rf /',
    '${TEAM_ID}',
    'ABCDE12345&'
  ])
    assert.throws(() => validateTeamId(value), undefined, value)
  assert.equal(validateTeamId('ABCDE12345'), 'ABCDE12345')
  for (const value of [
    '',
    '.com.example',
    'com..example',
    'com.example.',
    '-com.example',
    'com.example.app; rm -rf /',
    'com/example',
    '${BUNDLE_ID}',
    'com.example app'
  ])
    assert.throws(() => validateBundleId(value), undefined, value)
  assert.equal(
    validateBundleId('com.example.desktop.preview'),
    'com.example.desktop.preview'
  )
})

test('verification evidence never claims success from failing commands', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign verify fail '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  const dmg = join(root, 'candidate.dmg')
  await mkdir(app)
  await writeFile(dmg, 'stapled-bytes')
  const failing = async () => ({ status: 1, stdout: '', stderr: 'rejected' })
  const evidence = await verify({ appBundle: app, dmg, runner: failing })
  assert.equal(evidence.signature, 'unverified')
  assert.equal(evidence.notarization, 'unverified')
  assert.equal(evidence.ok, false)
})

test('verification assesses the DMG as an opened primary-signature document', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign verify spctl '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  const dmg = join(root, 'candidate.dmg')
  await mkdir(app)
  await writeFile(dmg, 'bytes')
  const calls = []
  const runner = async (file, args) => {
    calls.push([file, ...args])
    return { status: 0, stdout: '', stderr: '' }
  }
  const evidence = await verify({ appBundle: app, dmg, runner })
  assert.equal(evidence.ok, true)
  assert.deepEqual(calls[0], [
    '/usr/sbin/spctl',
    '-a',
    '-vvv',
    '-t',
    'open',
    '--context',
    'context:primary-signature',
    dmg
  ])
})

test('each single failed verification check makes the CLI exit nonzero', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign cli '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  const dmg = join(root, 'candidate.dmg')
  await mkdir(app)
  await writeFile(dmg, 'bytes')
  const config = join(root, 'verify.json')
  await writeFile(config, JSON.stringify({ appBundle: app, dmg }))
  for (const failing of [
    '/usr/sbin/spctl',
    '/usr/bin/codesign',
    '/usr/bin/xcrun'
  ]) {
    const runner = async (file) => ({
      status: file === failing ? 1 : 0,
      stdout: '',
      stderr: ''
    })
    const printed = []
    const code = await runCli(['verify', config], {
      runner,
      out: (line) => printed.push(line)
    })
    assert.equal(code, 1, failing)
    assert.equal(JSON.parse(printed[0]).ok, false, failing)
  }
  const passing = async () => ({ status: 0, stdout: '', stderr: '' })
  assert.equal(
    await runCli(['verify', config], { runner: passing, out() {} }),
    0
  )
})

test('verification evidence never claims success from inputs alone', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign verify inputs '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  const dmg = join(root, 'candidate.dmg')
  await mkdir(app)
  await writeFile(dmg, 'bytes')
  const silent = async () => ({ status: 1, stdout: '', stderr: '' })
  const evidence = await verify({ appBundle: app, dmg, runner: silent })
  assert.equal(evidence.signature, 'unverified')
  assert.equal(evidence.notarization, 'unverified')
  assert.ok(!['accepted', 'stapled'].includes(evidence.notarization))
})

test('verification evidence reports developer-id and stapled from command results', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign verify pass '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  const dmg = join(root, 'candidate.dmg')
  await mkdir(app)
  await writeFile(dmg, 'final-stapled-bytes')
  const passing = async () => ({ status: 0, stdout: '', stderr: '' })
  const evidence = await verify({ appBundle: app, dmg, runner: passing })
  assert.equal(evidence.signature, 'developer-id')
  assert.equal(evidence.notarization, 'stapled')
  assert.equal(
    evidence.artifactSha256,
    createHash('sha256').update('final-stapled-bytes').digest('hex')
  )
})

test('notarization is accepted but not stapled when only gatekeeper passes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac sign verify accepted '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  const dmg = join(root, 'candidate.dmg')
  await mkdir(app)
  await writeFile(dmg, 'bytes')
  const runner = async (file, args) => {
    if (args.includes('stapler')) return { status: 1, stdout: '', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  const evidence = await verify({ appBundle: app, dmg, runner })
  assert.equal(evidence.signature, 'developer-id')
  assert.equal(evidence.notarization, 'accepted')
})

async function signingFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mac sign order '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Candidate.app')
  const runtime = join(app, 'Contents/Resources/runtime')
  const electron = join(runtime, 'electron')
  const dirs = [
    'Contents/MacOS',
    'Contents/Resources/runtime/bin',
    'Contents/Resources/runtime/electron/Electron.app/Contents/MacOS',
    'Contents/Resources/runtime/electron/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A'
  ]
  for (const dir of dirs) await mkdir(join(app, dir), { recursive: true })
  const machO = [
    'Contents/MacOS/TacticusAnalytics',
    'Contents/Resources/runtime/bin/secret-vault',
    'Contents/Resources/runtime/bin/node',
    'Contents/Resources/runtime/electron/Electron.app/Contents/MacOS/Electron',
    'Contents/Resources/runtime/electron/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
  ]
  for (const file of machO) await writeFile(join(app, file), MACH_O)
  await writeFile(
    join(app, 'Contents/Resources/package-inventory.json'),
    JSON.stringify({
      schemaVersion: 2,
      platform: 'macos',
      kind: 'unsigned-developer-candidate',
      files: [],
      directories: []
    })
  )
  const profile = join(root, 'profile.mobileprovision')
  await writeFile(profile, 'profile-bytes')
  return { root, app, runtime, electron, profile }
}

test('signs nested bundles after their contents, inside-out, sealing the app last', async (t) => {
  const { app, electron, profile } = await signingFixture(t)
  const calls = []
  const runner = async (file, args) => {
    calls.push({ file, args })
    return { status: 0, stdout: '', stderr: '' }
  }
  const inventoryCalls = []
  const result = await sign({
    appBundle: app,
    identity: IDENTITY,
    teamId: 'ABCDE12345',
    bundleId: 'com.example.desktop.preview',
    provisioningProfile: profile,
    runner,
    inventory: async (directory) => {
      inventoryCalls.push(directory)
      return {
        files: [{ path: 'Contents/MacOS/x', bytes: 1, sha256: 'a' }],
        directories: ['Contents']
      }
    }
  })
  const signed = calls
    .filter((call) => call.file === '/usr/bin/codesign')
    .map((call) => call.args.at(-1))
  const framework = join(
    electron,
    'Electron.app/Contents/Frameworks/Electron Framework.framework'
  )
  const helperApp = join(
    app,
    'Contents/Resources/runtime/helpers/SecretVault.app'
  )
  const index = (path) => signed.indexOf(path)
  assert.equal(result.signed, signed.length)
  assert.equal(signed.at(-1), app)
  // Bundles are signed as bundles, after the code they contain.
  for (const [inner, bundle] of [
    [join(framework, 'Versions/A/Electron Framework'), framework],
    [
      join(electron, 'Electron.app/Contents/MacOS/Electron'),
      join(electron, 'Electron.app')
    ],
    [join(helperApp, 'Contents/MacOS/secret-vault'), helperApp]
  ]) {
    assert.ok(index(inner) >= 0 && index(bundle) > index(inner), bundle)
  }
  assert.ok(index(join(electron, 'Electron.app')) >= 0)
  // The profile reached the app and the vault helper bundle.
  assert.equal(
    await readFile(join(app, 'Contents/embedded.provisionprofile'), 'utf8'),
    'profile-bytes'
  )
  assert.equal(
    await readFile(
      join(helperApp, 'Contents/embedded.provisionprofile'),
      'utf8'
    ),
    'profile-bytes'
  )
  // Inventory is regenerated after the nested code was signed, before sealing.
  assert.deepEqual(inventoryCalls, [app])
  const manifest = JSON.parse(
    await readFile(
      join(app, 'Contents/Resources/package-inventory.json'),
      'utf8'
    )
  )
  assert.equal(manifest.kind, 'signed-developer-id-candidate')
  assert.equal(manifest.files[0].path, 'Contents/MacOS/x')
  assert.match(result.inventorySha256, /^[a-f0-9]{64}$/u)
})

test('entitlements are scoped: keychain only on the vault helper, JIT keys on Electron and Node', async (t) => {
  const { app, electron, profile } = await signingFixture(t)
  const used = new Map()
  const runner = async (file, args) => {
    const at = args.indexOf('--entitlements')
    if (at >= 0) used.set(args.at(-1), await readFile(args[at + 1], 'utf8'))
    else used.set(args.at(-1), null)
    return { status: 0, stdout: '', stderr: '' }
  }
  await sign({
    appBundle: app,
    identity: IDENTITY,
    teamId: 'ABCDE12345',
    bundleId: 'com.example.desktop.preview',
    provisioningProfile: profile,
    runner,
    inventory: async () => ({ files: [], directories: [] })
  })
  const helperApp = join(
    app,
    'Contents/Resources/runtime/helpers/SecretVault.app'
  )
  for (const [target, text] of used) {
    if (target.startsWith(helperApp))
      assert.match(text, /keychain-access-groups/u, target)
    else if (text) assert.doesNotMatch(text, /keychain-access-groups/u, target)
  }
  assert.match(
    used.get(join(electron, 'Electron.app')),
    /allow-unsigned-executable-memory/u
  )
  assert.match(
    used.get(join(app, 'Contents/Resources/runtime/bin/node')),
    /allow-jit/u
  )
  assert.equal(used.get(app), null)
  assert.equal(used.get(join(app, 'Contents/MacOS/TacticusAnalytics')), null)
})

test('the vault moves into its own bundle and the runtime path links to it', async (t) => {
  const { app, profile } = await signingFixture(t)
  await sign({
    appBundle: app,
    identity: IDENTITY,
    teamId: 'ABCDE12345',
    bundleId: 'com.example.desktop.preview',
    provisioningProfile: profile,
    runner: async () => ({ status: 0, stdout: '', stderr: '' }),
    inventory: async () => ({ files: [], directories: [] })
  })
  assert.equal(
    await readlink(join(app, 'Contents/Resources/runtime/bin/secret-vault')),
    '../helpers/SecretVault.app/Contents/MacOS/secret-vault'
  )
  const info = await readFile(
    join(
      app,
      'Contents/Resources/runtime/helpers/SecretVault.app/Contents/Info.plist'
    ),
    'utf8'
  )
  assert.match(info, /<string>com\.example\.desktop\.preview<\/string>/u)
})

test('a codesign failure stops signing before the bundle is sealed', async (t) => {
  const { app, profile } = await signingFixture(t)
  const calls = []
  const runner = async (file, args) => {
    calls.push(args.at(-1))
    return {
      status: args.at(-1).endsWith('/node') ? 1 : 0,
      stdout: '',
      stderr: 'rejected'
    }
  }
  await assert.rejects(
    sign({
      appBundle: app,
      identity: IDENTITY,
      teamId: 'ABCDE12345',
      bundleId: 'com.example.desktop.preview',
      provisioningProfile: profile,
      runner,
      inventory: async () => ({ files: [], directories: [] })
    }),
    /codesign rejected/u
  )
  assert.ok(!calls.includes(app))
})
