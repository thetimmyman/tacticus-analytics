import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  unlink,
  rm,
  symlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  captureApplicationPayload,
  captureCleanCheckoutProvenance,
  desktopBuildEnvironment,
  desktopBuildRecord,
  verifyApplicationLockfile,
  verifyApplicationPayload,
  verifyDesktopBuild,
  verifyRecordedDesktopBuild,
  requireCleanBuildEnvironment
} from './build-profile.mjs'
import { stageApplicationNotices } from './application-notices.mjs'

test('desktop build uses loopback placeholders and excludes inherited hosted secrets', () => {
  const env = desktopBuildEnvironment({
    PATH: '/synthetic/bin',
    NEXT_PUBLIC_RUNTIME_PROFILE: 'hosted',
    NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.example.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-hosted-key',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    SENTRY_AUTH_TOKEN: 'synthetic-token'
  })
  assert.equal(env.PATH, '/synthetic/bin')
  assert.equal(env.NEXT_PUBLIC_RUNTIME_PROFILE, 'desktop')
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:3000/supabase')
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'desktop-public')
  assert.equal(env.STANDALONE_BUILD, 'true')
  assert.equal(env.NEXT_TELEMETRY_DISABLED, '1')
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined)
  assert.equal(env.SENTRY_AUTH_TOKEN, undefined)
})

test('desktop build keeps the Windows process essentials npm.cmd needs', () => {
  const env = desktopBuildEnvironment({
    PATH: 'C:\\synthetic\\bin',
    SystemRoot: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    APPDATA: 'C:\\synthetic\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\synthetic\\AppData\\Local',
    GITHUB_TOKEN: 'synthetic-token'
  })
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.ComSpec, 'C:\\Windows\\system32\\cmd.exe')
  assert.equal(env.PATHEXT, '.COM;.EXE;.BAT;.CMD')
  assert.equal(env.LOCALAPPDATA, 'C:\\synthetic\\AppData\\Local')
  assert.equal(env.GITHUB_TOKEN, undefined)
})

test('automatic environment files refuse before build; examples are permitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-build-profile-'))
  try {
    await writeFile(join(root, '.env.example'), 'SYNTHETIC_PLACEHOLDER=1')
    await requireCleanBuildEnvironment(root)
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.production.local'
    ]) {
      await writeFile(join(root, name), 'SYNTHETIC_PLACEHOLDER=1')
      await assert.rejects(
        requireCleanBuildEnvironment(root),
        /automatic environment files/
      )
      await unlink(join(root, name))
    }
  } finally {
    await rm(root, { recursive: true })
  }
})

test('stage verification rejects hosted, incomplete and replaced builds', () => {
  const required = JSON.stringify({
    config: {
      output: 'standalone',
      experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
    }
  })
  const record = desktopBuildRecord(required, 'synthetic-build')
  verifyDesktopBuild(record, required, 'synthetic-build')
  assert.throws(() => verifyDesktopBuild(null, required, 'synthetic-build'))
  assert.throws(() => verifyDesktopBuild(record, required, 'other-build'))
  assert.throws(() =>
    verifyDesktopBuild(record, required + '\n', 'synthetic-build')
  )
  assert.throws(() =>
    desktopBuildRecord(
      JSON.stringify({ config: { output: 'standalone', experimental: {} } }),
      'synthetic-build'
    )
  )
  assert.throws(() => desktopBuildRecord(required, ''))
})

test('a plain build without a record refuses with the desktop build remedy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-build-record-'))
  const recordPath = join(root, '.next/desktop-build.json')
  const required = JSON.stringify({
    config: {
      output: 'standalone',
      experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
    }
  })
  try {
    await assert.rejects(
      verifyRecordedDesktopBuild(root, recordPath),
      /missing or stale; rebuild with npm run desktop:build/
    )
    await mkdir(join(root, '.next'))
    await writeFile(join(root, '.next/required-server-files.json'), required)
    await writeFile(join(root, '.next/BUILD_ID'), 'synthetic-build')
    await assert.rejects(
      verifyRecordedDesktopBuild(root, recordPath),
      /missing or stale; rebuild with npm run desktop:build/
    )
    await writeFile(
      recordPath,
      JSON.stringify(desktopBuildRecord(required, 'synthetic-build'))
    )
    await verifyRecordedDesktopBuild(root, recordPath)
    await writeFile(join(root, '.next/BUILD_ID'), 'replaced-build')
    await assert.rejects(
      verifyRecordedDesktopBuild(root, recordPath),
      /missing or stale/
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('the desktop build script is the entry point that writes the record', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const { scripts } = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8')
  )
  assert.equal(
    scripts['desktop:build'],
    'node apps/desktop/proof/build-application.mjs'
  )
  const builder = await readFile(
    join(root, 'apps/desktop/proof/build-application.mjs'),
    'utf8'
  )
  assert.match(builder, /\.next\/desktop-build\.json/)
  assert.match(builder, /sourceCommit/)
  assert.match(builder, /packageLockSha256/)
})

test('desktop build provenance binds valid sourceCommit and packageLockSha256 and rejects drift', async () => {
  const required = JSON.stringify({
    config: {
      output: 'standalone',
      experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
    }
  })
  const commit = 'a'.repeat(40)
  const lockHash = 'b'.repeat(64)
  const record = desktopBuildRecord(required, 'synthetic-build', {
    sourceCommit: commit,
    packageLockSha256: lockHash
  })
  assert.equal(record.sourceCommit, commit)
  assert.equal(record.packageLockSha256, lockHash)
  verifyDesktopBuild(record, required, 'synthetic-build', {
    sourceCommit: commit,
    packageLockSha256: lockHash
  })
  assert.throws(() =>
    desktopBuildRecord(required, 'synthetic-build', {
      sourceCommit: 'not-a-sha'
    })
  )
  assert.throws(() =>
    desktopBuildRecord(required, 'synthetic-build', {
      packageLockSha256: 'bad'
    })
  )
  assert.throws(() =>
    verifyDesktopBuild(record, required, 'synthetic-build', {
      sourceCommit: 'c'.repeat(40),
      packageLockSha256: lockHash
    })
  )
  assert.throws(() =>
    verifyDesktopBuild(record, required, 'synthetic-build', {
      sourceCommit: commit,
      packageLockSha256: 'd'.repeat(64)
    })
  )
})

test('staged application lockfile check rejects stale lockfiles and stage-linux enforces provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-lock-provenance-'))
  try {
    const expectedBytes =
      '{"packages":{"node_modules/seroval":{"version":"1.6.11"}}}'
    const expectedHash = createHash('sha256')
      .update(expectedBytes)
      .digest('hex')
    await verifyApplicationLockfile(root, expectedHash)
    await writeFile(join(root, 'package-lock.json'), expectedBytes)
    await verifyApplicationLockfile(root, expectedHash)
    await writeFile(
      join(root, 'package-lock.json'),
      '{"packages":{"node_modules/seroval":{"version":"1.6.8"}}}'
    )
    await assert.rejects(
      verifyApplicationLockfile(root, expectedHash),
      /Staged application package-lock\.json does not match source/
    )
    const stager = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), 'stage-linux.mjs'),
      'utf8'
    )
    assert.match(stager, /verifyRecordedDesktopBuild/)
    assert.match(stager, /verifyApplicationLockfile/)
    assert.match(stager, /packageLockSha256/)
    assert.match(stager, /sourceCommit/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('captureCleanCheckoutProvenance rejects non-git directories and nested subdirectories', async () => {
  const outer = await mkdtemp(join(tmpdir(), 'desktop-provenance-non-git-'))
  try {
    await writeFile(join(outer, 'package-lock.json'), '{}')
    await assert.rejects(
      captureCleanCheckoutProvenance(outer),
      /git checkout|checkout root/
    )
    const repoRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../..'
    )
    await assert.rejects(
      captureCleanCheckoutProvenance(join(repoRoot, 'apps/desktop')),
      /checkout root directory/
    )
  } finally {
    await rm(outer, { recursive: true, force: true })
  }
})

test('application payload manifest is canonical and refuses tampered or unbound records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-payload-manifest-'))
  try {
    const requiredFiles = JSON.stringify({
      config: {
        output: 'standalone',
        experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
      }
    })
    const serverBytes = '// synthetic server\n'
    const packageBytes = JSON.stringify({
      name: 'synthetic-pkg',
      version: '1.0.0',
      license: 'MIT'
    })
    const licenseBytes = 'Synthetic MIT notice\n'
    const entry = (path, bytes) => ({
      path,
      bytes: Buffer.byteLength(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
    const applicationFiles = [
      entry('node_modules/synthetic-pkg/LICENSE', licenseBytes),
      entry('node_modules/synthetic-pkg/package.json', packageBytes),
      entry('server.js', serverBytes)
    ]
    const record = desktopBuildRecord(requiredFiles, 'build-1', {
      applicationFiles
    })
    assert.equal(
      record.applicationManifestSha256,
      createHash('sha256')
        .update(JSON.stringify(applicationFiles))
        .digest('hex')
    )
    await writeFile(join(root, 'server.js'), serverBytes)
    await mkdir(join(root, 'node_modules/synthetic-pkg'), { recursive: true })
    await writeFile(
      join(root, 'node_modules/synthetic-pkg/package.json'),
      packageBytes
    )
    await writeFile(
      join(root, 'node_modules/synthetic-pkg/LICENSE'),
      licenseBytes
    )
    await writeFile(join(root, 'desktop-build.json'), JSON.stringify(record))
    const sourceModules = await mkdtemp(join(tmpdir(), 'desktop-source-mods-'))
    try {
      // The real notice stager writes application-notices.json beside the payload.
      await stageApplicationNotices({ application: root, sourceModules })
    } finally {
      await rm(sourceModules, { recursive: true, force: true })
    }
    const digests = await verifyApplicationPayload(root, record)
    assert.deepEqual([...digests.keys()].sort(), [
      'application-notices.json',
      'desktop-build.json',
      'node_modules/synthetic-pkg/LICENSE',
      'node_modules/synthetic-pkg/package.json',
      'server.js',
      'third-party-notices/synthetic-pkg/LICENSE'
    ])

    // The generated inventory must describe the bound packages exactly.
    const noticesPath = join(root, 'application-notices.json')
    const generated = await readFile(noticesPath, 'utf8')
    const rewrite = async (change) => {
      const inventory = JSON.parse(generated)
      change(inventory)
      await writeFile(noticesPath, JSON.stringify(inventory, null, 2))
    }
    for (const [change, message] of [
      [
        (inventory) => {
          inventory.packages[0].version = '9.9.9'
        },
        /notice inventory package metadata/
      ],
      [
        (inventory) => {
          inventory.packagesRequiringReview = 1
        },
        /notice inventory review count/
      ],
      [
        (inventory) => {
          inventory.packages[0].notices[0].origin = 'elsewhere'
        },
        /notice inventory entry/
      ],
      [
        (inventory) => {
          inventory.packages[0].extra = true
        },
        /notice inventory package fields/
      ],
      [
        (inventory) => {
          inventory.packages[0].notices[0].path =
            'third-party-notices/synthetic-pkg/../synthetic-pkg/LICENSE'
        },
        /notice inventory path/
      ]
    ]) {
      await rewrite(change)
      await assert.rejects(verifyApplicationPayload(root, record), message)
    }
    await writeFile(noticesPath, generated)
    await verifyApplicationPayload(root, record)

    // Entries are opened without following links; links and special files are refused
    // from the opened descriptor, and a FIFO is refused without blocking on a writer.
    const special = async (name, create, message) => {
      await create(join(root, name))
      try {
        await assert.rejects(verifyApplicationPayload(root, record), message)
      } finally {
        await rm(join(root, name), { recursive: true, force: true })
      }
    }
    await special(
      'linked.js',
      (path) => symlink(join(root, 'server.js'), path),
      /Symlink in staged application refused: linked\.js/
    )
    await special(
      'linked-dir',
      (path) => symlink(join(root, 'node_modules'), path),
      /Symlink in staged application refused: linked-dir/
    )
    await special(
      'pipe',
      async (path) => execFileSync('mkfifo', [path]),
      /Unsupported staged application entry: pipe/
    )
    // Node unlinks a Unix socket when its server closes, so keep it listening while checked.
    const server = createServer()
    await new Promise((done, fail) => {
      server.once('error', fail)
      server.listen(join(root, 'socket'), done)
    })
    try {
      await assert.rejects(
        verifyApplicationPayload(root, record),
        /Unsupported staged application entry: socket/
      )
    } finally {
      await new Promise((done) => server.close(done))
    }
    await verifyApplicationPayload(root, record)

    await assert.rejects(
      verifyApplicationPayload(root, {
        ...record,
        applicationFiles: undefined
      }),
      /does not bind the application payload/
    )
    await assert.rejects(
      verifyApplicationPayload(root, {
        ...record,
        applicationFiles: [{ ...applicationFiles[0], sha256: 'a'.repeat(64) }]
      }),
      /manifest digest mismatch/
    )
    assert.throws(
      () =>
        desktopBuildRecord(requiredFiles, 'build-1', {
          applicationFiles: [{ ...applicationFiles[0], path: '../escape.js' }]
        }),
      /Invalid desktop build applicationFiles/
    )
    assert.throws(
      () =>
        desktopBuildRecord(requiredFiles, 'build-1', {
          applicationFiles: [
            { ...applicationFiles[0], path: 'z.js' },
            { ...applicationFiles[0], path: 'a.js' }
          ]
        }),
      /order/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('application payload capture follows links like the standalone copy and refuses special files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-payload-capture-'))
  try {
    const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
    await mkdir(join(root, '.next/standalone/lib'), { recursive: true })
    await mkdir(join(root, '.next/static/chunks'), { recursive: true })
    await mkdir(join(root, 'public'), { recursive: true })
    await mkdir(join(root, 'outside'), { recursive: true })
    await writeFile(join(root, '.next/standalone/server.js'), 'server\n')
    await writeFile(join(root, '.next/standalone/lib/a.js'), 'a\n')
    await writeFile(join(root, '.next/static/chunks/main.js'), 'main\n')
    await writeFile(join(root, 'outside/linked.txt'), 'linked\n')
    await symlink(
      join(root, 'outside/linked.txt'),
      join(root, 'public/linked.txt')
    )
    await symlink(join(root, 'outside'), join(root, 'public/dir'))
    assert.deepEqual(await captureApplicationPayload(root), [
      { path: '.next/static/chunks/main.js', bytes: 5, sha256: sha('main\n') },
      { path: 'lib/a.js', bytes: 2, sha256: sha('a\n') },
      { path: 'public/dir/linked.txt', bytes: 7, sha256: sha('linked\n') },
      { path: 'public/linked.txt', bytes: 7, sha256: sha('linked\n') },
      { path: 'server.js', bytes: 7, sha256: sha('server\n') }
    ])

    execFileSync('mkfifo', [join(root, 'public/pipe')])
    await assert.rejects(
      captureApplicationPayload(root),
      /Unsupported desktop application payload entry: public\/pipe/
    )
    await unlink(join(root, 'public/pipe'))
    await symlink(join(root, 'missing'), join(root, 'public/dangling'))
    await assert.rejects(captureApplicationPayload(root), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Coordinated tampering: the inventory and the staged copies are rewritten together, so
// self-consistency holds; only derivation from the bound payload can refuse them.
test('application notice inventory derives traced notices and digests from the bound payload', async () => {
  const requiredFiles = JSON.stringify({
    config: {
      output: 'standalone',
      experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
    }
  })
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const payload = {
    'server.js': '// synthetic server\n',
    'node_modules/synthetic-pkg/package.json': JSON.stringify({
      name: 'synthetic-pkg',
      version: '1.0.0',
      license: 'MIT'
    }),
    'node_modules/synthetic-pkg/LICENSE': 'Synthetic MIT notice\n',
    'node_modules/synthetic-pkg/docs/NOTICE': 'Synthetic nested notice\n',
    // The stager skips empty notices and anything under a nested node_modules.
    'node_modules/synthetic-pkg/COPYING': '',
    'node_modules/synthetic-pkg/node_modules/inner/LICENSE': 'Inner notice\n',
    'node_modules/synthetic-pkg/node_modules/inner/package.json':
      JSON.stringify({ name: 'inner', version: '2.0.0', license: 'ISC' }),
    'node_modules/bare-pkg/package.json': JSON.stringify({
      name: 'bare-pkg',
      version: '3.0.0',
      license: 'MIT'
    }),
    'node_modules/bare-pkg/index.js': 'module.exports = 3\n'
  }
  const applicationFiles = Object.entries(payload)
    .map(([path, bytes]) => ({
      path,
      bytes: Buffer.byteLength(bytes),
      sha256: sha(bytes)
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
  const record = desktopBuildRecord(requiredFiles, 'build-1', {
    applicationFiles
  })

  async function stage() {
    const root = await mkdtemp(join(tmpdir(), 'desktop-notice-derive-'))
    for (const [path, bytes] of Object.entries(payload)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), bytes)
    }
    await writeFile(join(root, 'desktop-build.json'), JSON.stringify(record))
    // An installed source copy contributes one extra notice for bare-pkg.
    const sourceModules = await mkdtemp(join(tmpdir(), 'desktop-source-mods-'))
    await mkdir(join(sourceModules, 'bare-pkg'), { recursive: true })
    await writeFile(
      join(sourceModules, 'bare-pkg/package.json'),
      payload['node_modules/bare-pkg/package.json']
    )
    await writeFile(join(sourceModules, 'bare-pkg/NOTICE'), 'Source notice\n')
    try {
      await stageApplicationNotices({ application: root, sourceModules })
    } finally {
      await rm(sourceModules, { recursive: true, force: true })
    }
    return root
  }

  // Control: the real stager's output is accepted, including the source-only notice.
  const control = await stage()
  try {
    const digests = await verifyApplicationPayload(control, record)
    assert.deepEqual(
      [...digests.keys()]
        .filter((rel) => rel.startsWith('third-party-'))
        .sort(),
      [
        'third-party-notices/bare-pkg/NOTICE',
        'third-party-notices/synthetic-pkg/LICENSE',
        'third-party-notices/synthetic-pkg/docs/NOTICE',
        'third-party-notices/synthetic-pkg/node_modules/inner/LICENSE'
      ]
    )
  } finally {
    await rm(control, { recursive: true, force: true })
  }

  const entryOf = (inventory, packagePath) =>
    inventory.packages.find((entry) => entry.packagePath === packagePath)
  const cases = {
    // Sol 1: altered traced license copy, inventory digest updated to match the copy.
    'altered-traced-copy': async (root, inventory) => {
      const forged = 'Forged licence text\n'
      await writeFile(
        join(root, 'third-party-notices/synthetic-pkg/LICENSE'),
        forged
      )
      entryOf(inventory, 'synthetic-pkg').notices.find(
        (notice) => notice.path === 'third-party-notices/synthetic-pkg/LICENSE'
      ).sha256 = sha(forged)
    },
    // Sol 2: every copied notice removed and the package marked review-required.
    'review-required-despite-bound-license': async (root, inventory) => {
      await rm(join(root, 'third-party-notices/synthetic-pkg/LICENSE'))
      await rm(join(root, 'third-party-notices/synthetic-pkg/docs'), {
        recursive: true
      })
      const entry = entryOf(inventory, 'synthetic-pkg')
      entry.notices = []
      entry.status = 'review-required'
      inventory.packagesRequiringReview += 1
    },
    // One bound traced notice dropped from both the copies and the inventory.
    'dropped-traced-notice': async (root, inventory) => {
      await rm(join(root, 'third-party-notices/synthetic-pkg/docs'), {
        recursive: true
      })
      const entry = entryOf(inventory, 'synthetic-pkg')
      entry.notices = entry.notices.filter(
        (notice) => !notice.path.endsWith('/docs/NOTICE')
      )
    },
    // A bound traced notice relabelled as coming from the installed source tree.
    'traced-relabelled-as-source': async (_root, inventory) => {
      entryOf(inventory, 'synthetic-pkg').notices.find(
        (notice) => notice.path === 'third-party-notices/synthetic-pkg/LICENSE'
      ).origin = 'installed-source-package'
    },
    // An invented traced notice that is not in the bound payload.
    'invented-traced-notice': async (root, inventory) => {
      const invented = 'Invented notice\n'
      await writeFile(
        join(root, 'third-party-notices/bare-pkg/LICENSE'),
        invented
      )
      entryOf(inventory, 'bare-pkg').notices.push({
        path: 'third-party-notices/bare-pkg/LICENSE',
        origin: 'traced-package',
        sha256: sha(invented)
      })
    },
    // A source notice must not shadow a traced notice of the same name.
    'source-notice-shadows-traced': async (root, inventory) => {
      const shadow = 'Shadow notice\n'
      await writeFile(
        join(root, 'third-party-notices/synthetic-pkg/LICENSE'),
        shadow
      )
      const notice = entryOf(inventory, 'synthetic-pkg').notices.find(
        (item) => item.path === 'third-party-notices/synthetic-pkg/LICENSE'
      )
      notice.origin = 'installed-source-package'
      notice.sha256 = sha(shadow)
    }
  }
  const outcomes = []
  for (const [label, tamper] of Object.entries(cases)) {
    const root = await stage()
    try {
      const noticesPath = join(root, 'application-notices.json')
      const inventory = JSON.parse(await readFile(noticesPath, 'utf8'))
      await tamper(root, inventory)
      await writeFile(noticesPath, JSON.stringify(inventory, null, 2))
      const error = await verifyApplicationPayload(root, record).then(
        () => null,
        (reason) => reason.message
      )
      outcomes.push([
        label,
        /disagree(s)? with the bound payload/.test(error ?? '')
          ? 'refused'
          : (error ?? 'accepted')
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
  assert.deepEqual(
    outcomes,
    Object.keys(cases).map((label) => [label, 'refused'])
  )
})
