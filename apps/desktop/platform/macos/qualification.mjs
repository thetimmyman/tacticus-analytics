import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { stage, inventory } from './stage.mjs'
import { records } from './evidence.mjs'

const inputs = resolve(process.argv[2]),
  application = resolve(process.argv[3]),
  native = resolve(process.argv[4])
if (process.platform !== 'darwin')
  throw new Error('Actual native macOS required')
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
    recursive: true
  })
} finally {
  execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'pipe' })
}
const runtime = join(installed, 'Contents/Resources/runtime'),
  state = join(working, 'workspace')
await mkdir(state, { mode: 0o700 })
const verify = join(working, 'verify.json')
const config = {
  synthetic: true,
  password: 'Synthetic local password 27!',
  evidence: join(working, 'renderer.json'),
  screenshot: join(working, 'renderer.png')
}
await writeFile(verify, JSON.stringify(config), { mode: 0o600 })
// The sandbox applies to the full installed descendant tree. This policy is a
// qualification tool, not a request to weaken any consumer OS protection.
const policy =
  '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))'
async function run(arguments_) {
  const child = spawn(
    '/usr/bin/sandbox-exec',
    [
      '-p',
      policy,
      join(installed, 'Contents/MacOS/TacticusAnalytics'),
      '--run',
      join(state, 'owner.lock'),
      join(runtime, 'bin/node'),
      join(runtime, 'apps/desktop/platform/macos/runtime.mjs'),
      '--verify',
      verify,
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
  const deadline = setTimeout(() => child.kill('SIGTERM'), 180000)
  try {
    const code = await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('exit', accept)
    })
    if (code !== 0)
      throw new Error('Installed developer package journey failed')
  } finally {
    clearTimeout(deadline)
  }
}
await run([])
await run(['--storage-check', join(working, 'storage-first.json')])
await run(['--storage-check', join(working, 'storage-second.json')])
const first = JSON.parse(await readFile(join(working, 'storage-first.json'))),
  second = JSON.parse(await readFile(join(working, 'storage-second.json')))
if (first.counter !== 1 || second.counter !== 2)
  throw new Error('Restart did not retain installed writes')
const files = await inventory(installed)
const attachments = []
for (const [name, mediaType] of [
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
