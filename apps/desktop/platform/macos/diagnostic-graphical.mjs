import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inventory } from './stage.mjs'
import { qualificationTarget } from './qualification-network.mjs'
import diagnostics from './request-diagnostics.cjs'

export function extractDiagnosticBase(archive, directory) {
  if (!isAbsolute(archive) || !isAbsolute(directory))
    throw new Error('Absolute diagnostic archive paths are required')
  execFileSync(
    'python3',
    [
      '-c',
      `
import pathlib, shutil, stat, sys, zipfile
archive, destination = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
allowed = {'artifact.json', 'candidate.dmg', 'package-inventory.json', 'platform-evidence.json', 'device-session.json', 'restart-device-session.json', 'network-policy.json', 'renderer.json', 'renderer.png', 'renderer.json.failure.json', 'renderer.json.native.json', 'restart-renderer.json', 'restart-renderer.png', 'restart-renderer.json.failure.json', 'restart-renderer.json.native.json', 'supervisor-network.json', 'restart-supervisor-network.json', 'storage-first.json', 'storage-second.json'}
required = {'artifact.json', 'candidate.dmg', 'package-inventory.json'}
with zipfile.ZipFile(archive) as bundle:
    entries = bundle.infolist()
    names = [entry.filename for entry in entries]
    if len(names) != len(set(names)) or len(names) > 30 or not required.issubset(names) or not set(names).issubset(allowed):
        raise SystemExit('Diagnostic archive paths or entries refused')
    if sum(entry.file_size for entry in entries) > 1024 ** 3:
        raise SystemExit('Diagnostic archive exceeds the bounded size')
    for entry in entries:
        mode = stat.S_IFMT(entry.external_attr >> 16)
        if entry.is_dir() or entry.flag_bits & 1 or mode not in (0, stat.S_IFREG):
            raise SystemExit('Diagnostic archive entry type refused')
    destination.mkdir(mode=0o700)
    for entry in entries:
        if entry.filename not in required:
            continue
        with bundle.open(entry) as source, (destination / entry.filename).open('xb') as target:
            shutil.copyfileobj(source, target)
`,
      archive,
      directory
    ],
    { stdio: 'pipe' }
  )
}

export function diagnosticObservation(observed) {
  return {
    nodeAccess: observed?.nodeAccess !== false,
    positiveScore: observed?.positiveScore === true,
    negativeScore: observed?.negativeScore === true,
    serviceDisruption: observed?.serviceDisruption !== false
  }
}

async function main() {
  // This intentionally modified developer package is only a diagnostic experiment.
  // Its results must never be published as installed product acceptance.
  const archive = process.argv[2],
    output = process.argv[3]
  const baseSource = 'b8e30d8dbe53a5fc47f28d54978f0ae22ac2fe4c'
  const pinnedImages = {
    arm64: 'bc3ffb714bc96f9ee16296bf5042c085b8fc14e0e0a92d0787230e654f360916',
    x64: 'dfe53e8fa606d74844e36a76b44e6c144fbeb40a41daf9df2bd65bde8ada993c'
  }
  if (
    process.platform !== 'darwin' ||
    !isAbsolute(archive ?? '') ||
    !isAbsolute(output ?? '')
  )
    throw new Error(
      'Native macOS and an absolute diagnostic output are required'
    )
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  if (source !== process.env.MAC_SOURCE_SHA)
    throw new Error('Diagnostic source does not match the checked-out commit')
  if (
    execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      encoding: 'utf8'
    }).trim()
  )
    throw new Error('Tracked diagnostic source is modified')
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const working = await mkdtemp(join(tmpdir(), 'ta mac diagnostic ü '))
  const base = join(working, 'base')
  extractDiagnosticBase(archive, base)
  const metadata = JSON.parse(
    await readFile(join(base, 'artifact.json'), 'utf8')
  )
  const imageHash = hash(await readFile(join(base, 'candidate.dmg')))
  if (
    metadata.sourceCommit !== baseSource ||
    metadata.architecture !== process.arch ||
    metadata.artifactSha256 !== imageHash ||
    imageHash !== pinnedImages[process.arch]
  )
    throw new Error('Immutable base artifact identity failed')
  await mkdir(output, { recursive: false, mode: 0o700 })
  const mount = join(working, 'mount'),
    installed = join(working, 'Applications ü/Tacticus Analytics Preview.app')
  await mkdir(mount)
  execFileSync(
    '/usr/bin/hdiutil',
    [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mount,
      join(base, 'candidate.dmg')
    ],
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
  const manifestPath = 'Contents/Resources/package-inventory.json'
  const manifest = JSON.parse(
    await readFile(join(installed, manifestPath), 'utf8')
  )
  const actual = (await inventory(installed)).filter(
    (file) => file.path !== manifestPath
  )
  if (
    manifest.sourceCommit !== baseSource ||
    JSON.stringify(actual) !== JSON.stringify(manifest.files)
  )
    throw new Error('Immutable installed base inventory failed')
  const runtime = join(installed, 'Contents/Resources/runtime'),
    overlays = []
  for (const name of ['main.cjs', 'request-diagnostics.cjs']) {
    const path = 'apps/desktop/platform/macos/' + name
    const bytes = await readFile(path)
    await writeFile(join(runtime, path), bytes)
    overlays.push({ path, sha256: hash(bytes), bytes: bytes.length })
  }
  const modifiedInventorySha256 = hash(
    JSON.stringify(await inventory(installed))
  )
  const state = join(working, 'workspace')
  await mkdir(state, { mode: 0o700 })
  const target = await qualificationTarget()
  const policy =
    '(version 1)(allow default)(deny network*)(allow network* (local unix-socket))(allow network* (remote unix-socket))(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))'
  const measurements = []
  for (const launch of [1, 2]) {
    const evidence = join(working, 'renderer-' + launch + '.json')
    const verify = join(working, 'verify-' + launch + '.json')
    await writeFile(
      verify,
      JSON.stringify({
        synthetic: true,
        sourceCommit: baseSource,
        artifactSha256: imageHash,
        networkPolicy: policy,
        externalAddress: target,
        deviceEvidence: join(working, 'device-' + launch + '.json'),
        supervisorEvidence: join(working, 'supervisor-' + launch + '.json'),
        evidence,
        screenshot: join(working, 'renderer-' + launch + '.png')
      }),
      { mode: 0o600 }
    )
    const child = spawn(
      join(installed, 'Contents/MacOS/TacticusAnalytics'),
      [
        '--run',
        join(state, 'owner.lock'),
        join(runtime, 'bin/node'),
        join(runtime, 'apps/desktop/platform/macos/window-broker.mjs'),
        '--verify',
        verify
      ],
      {
        env: {
          PATH: '/usr/bin:/bin',
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR
        },
        stdio: ['ignore', 'pipe', 'ignore']
      }
    )
    let stdout = '',
      timedOut = false
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 1024 * 1024) stdout += chunk.toString()
    })
    const deadline = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 180000)
    const escalation = setTimeout(() => child.kill('SIGKILL'), 185000)
    let exitCode
    try {
      exitCode = await new Promise((accept, reject) => {
        child.once('error', reject)
        child.once('close', accept)
      })
    } finally {
      clearTimeout(deadline)
      clearTimeout(escalation)
    }
    const failures = []
    for (const line of stdout.split('\n')) {
      const marker = 'TA-MAC-VERIFY-FAILURE:'
      if (!line.startsWith(marker)) continue
      try {
        failures.push(
          diagnostics.sanitizeFailure(JSON.parse(line.slice(marker.length)))
        )
      } catch {
        /* Untrusted child output is never copied. */
      }
    }
    let renderer
    try {
      const value = JSON.parse(await readFile(evidence, 'utf8'))
      renderer = {
        observed: diagnosticObservation(value.observed),
        network: diagnostics.sanitizeFailure({
          stage: 'renderer-network',
          cause: 'request-failed',
          network: value.network
        }).network
      }
    } catch {
      /* Missing renderer evidence is reported by the nonzero exit. */
    }
    measurements.push({
      launch,
      exitCode,
      timedOut,
      failures,
      ...(renderer ? { renderer } : {})
    })
  }
  const receipt = {
    schemaVersion: 'macos-graphical-diagnostic/v1',
    classification: 'diagnostic',
    accepted: false,
    productAcceptance: false,
    architecture: process.arch,
    base: {
      sourceCommit: baseSource,
      artifactSha256: imageHash,
      inventoryVerified: true
    },
    overlay: {
      sourceCommit: source,
      files: overlays,
      modifiedPackageInventorySha256: modifiedInventorySha256
    },
    measurements,
    scope:
      'Two synthetic graphical launches of an explicitly modified copy; immutable base web/native inputs reused. Final repaired source requires normal complete packaging and acceptance.'
  }
  await writeFile(
    join(output, 'diagnostic-results.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { mode: 0o600 }
  )
  console.log(JSON.stringify(receipt))
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
