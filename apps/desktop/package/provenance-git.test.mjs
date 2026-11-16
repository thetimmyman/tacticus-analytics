import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const PROOF_RUNTIME_FILES = [
  'native-services.mjs',
  'service-owner.mjs',
  'service-client.mjs',
  'schema-lifecycle.mjs',
  'safe-files.mjs',
  'workspace-transfer.mjs',
  'loopback-gateway.mjs',
  'synthetic-import.mjs',
  'renderer-wake.cjs',
  'core-pages.cjs',
  'addons-journey.cjs',
  'electron-shell.cjs',
  'guild-teams-renderer.cjs',
  'token-usage-renderer.cjs',
  'target-assignments-renderer.cjs',
  'season-planning-renderer.cjs'
]

function cleanGitEnv(extra = {}) {
  const base = { ...process.env }
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES'
  ]) {
    delete base[key]
  }
  return { ...base, ...extra }
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: cleanGitEnv(),
    encoding: 'utf8'
  }).trim()
}

async function copyFromRepo(targetRepo, relativePath) {
  const destination = join(targetRepo, relativePath)
  await mkdir(dirname(destination), { recursive: true })
  await cp(join(repoRoot, relativePath), destination, { recursive: true })
}

async function createTempCheckout() {
  const home = await mkdtemp(join(tmpdir(), 'desktop-provenance-git-'))
  const repo = join(home, 'repo')
  const bin = join(home, 'bin')
  await mkdir(repo, { recursive: true })
  await mkdir(bin, { recursive: true })

  for (const relativePath of [
    'apps/desktop/proof/build-application.mjs',
    'apps/desktop/proof/safe-files.mjs',
    'apps/desktop/proof/stage-standalone.mjs',
    'apps/desktop/package/application-notices.mjs',
    'apps/desktop/package/build-profile.mjs',
    'apps/desktop/package/generate-sbom.mjs',
    'apps/desktop/package/stage-linux.mjs',
    'apps/desktop/package/addon-policy.json',
    'apps/desktop/package/updates.json',
    'apps/desktop/launcher/updates.mjs',
    'apps/desktop/runtime-inputs.json',
    'apps/addons/build-native.mjs',
    'scripts/security/scan-release-artifact.mjs'
  ]) {
    await copyFromRepo(repo, relativePath)
  }

  await mkdir(join(repo, 'app'), { recursive: true })
  await writeFile(
    join(repo, 'app/page.tsx'),
    'export default function Page() { return null }\n'
  )
  await mkdir(join(repo, 'apps/addons'), { recursive: true })
  await writeFile(
    join(repo, 'apps/addons/native-runtime.ts'),
    'export const runtime = 1\n'
  )
  await writeFile(
    join(repo, 'apps/addons/native-manager.tsx'),
    'export const manager = 1\n'
  )
  await mkdir(join(repo, 'apps/desktop/launcher'), { recursive: true })
  await writeFile(
    join(repo, 'apps/desktop/launcher/launch.mjs'),
    'export const version = "a"\n'
  )
  await mkdir(join(repo, 'apps/desktop/local-schema'), { recursive: true })
  await writeFile(
    join(repo, 'apps/desktop/local-schema/schema.sql'),
    'SELECT 1;\n'
  )

  for (const name of PROOF_RUNTIME_FILES) {
    if (name === 'safe-files.mjs') continue
    await writeFile(
      join(repo, 'apps/desktop/proof', name),
      '// synthetic runtime file\n'
    )
  }

  await writeFile(
    join(repo, '.gitignore'),
    [
      '/.next/',
      '/node_modules/',
      '*.tsbuildinfo',
      'next-env.d.ts',
      '.env',
      '.env.*',
      '!.env.example',
      'app/api/debug/',
      '*.bak',
      '!/public/',
      '/public/*',
      '!/public/favicon.svg',
      ''
    ].join('\n')
  )
  await mkdir(join(repo, 'public'), { recursive: true })
  await writeFile(join(repo, 'public/favicon.svg'), '<svg/>\n')
  await writeFile(join(repo, 'LICENSE'), 'Synthetic proprietary notice\n')
  await writeFile(
    join(repo, 'THIRD_PARTY_NOTICES.md'),
    '# Third-party notices\n'
  )
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify(
      {
        name: 'tacticus-analytics',
        version: '0.0.0-synthetic',
        private: true,
        scripts: { build: 'echo synthetic build' }
      },
      null,
      2
    ) + '\n'
  )
  const lockContents =
    JSON.stringify(
      {
        name: 'tacticus-analytics',
        version: '0.0.0-synthetic',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 'tacticus-analytics', version: '0.0.0-synthetic' },
          'node_modules/synthetic-pkg': {
            version: '1.0.0',
            integrity:
              'sha512-' +
              Buffer.from(
                'synthetic-integrity-bytes-0123456789abcdef0123456789abcdef0123456789ab'
              ).toString('base64'),
            license: 'MIT'
          }
        }
      },
      null,
      2
    ) + '\n'
  await writeFile(join(repo, 'package-lock.json'), lockContents)

  git(repo, ['init'])
  git(repo, ['config', 'user.name', 'Synthetic Builder'])
  git(repo, ['config', 'user.email', 'synthetic@example.invalid'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'synthetic initial commit'])

  // Ignored synthetic esbuild module so stage-linux addon bundling runs offline without repo node_modules.
  const bundleHookScript = join(home, 'during-bundle-hook.mjs')
  await mkdir(join(repo, 'node_modules/esbuild'), { recursive: true })
  await writeFile(
    join(repo, 'node_modules/esbuild/package.json'),
    JSON.stringify({
      name: 'esbuild',
      version: '0.0.0',
      type: 'module',
      exports: './index.mjs'
    })
  )
  await writeFile(
    join(repo, 'node_modules/esbuild/index.mjs'),
    `import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
let ranHook = false
export async function build({ outfile }) {
  await writeFile(outfile, '// synthetic addon bundle\\n')
  if (!ranHook && existsSync(${JSON.stringify(bundleHookScript)})) {
    ranHook = true
    const mod = await import(pathToFileURL(${JSON.stringify(bundleHookScript)}).href)
    await mod.mutate()
  }
}
`
  )

  // Ignored installed source package: stage-standalone preserves its extra NOTICE from here.
  await mkdir(join(repo, 'node_modules/synthetic-pkg'), { recursive: true })
  await writeFile(
    join(repo, 'node_modules/synthetic-pkg/package.json'),
    JSON.stringify({ name: 'synthetic-pkg', version: '1.0.0', license: 'MIT' })
  )
  await writeFile(
    join(repo, 'node_modules/synthetic-pkg/LICENSE'),
    'Synthetic MIT notice\n'
  )
  await writeFile(
    join(repo, 'node_modules/synthetic-pkg/NOTICE'),
    'Synthetic source-only notice\n'
  )

  const npmLog = join(home, 'npm-invoked.json')
  const hookScript = join(home, 'during-build-hook.mjs')
  const npmRunner = join(home, 'npm-runner.mjs')
  await writeFile(
    npmRunner,
    `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
writeFileSync(${JSON.stringify(npmLog)}, JSON.stringify(process.argv.slice(2)))
const cwd = process.cwd()
mkdirSync(join(cwd, '.next'), { recursive: true })
writeFileSync(
  join(cwd, '.next/required-server-files.json'),
  JSON.stringify({
    config: {
      output: 'standalone',
      experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
    }
  })
)
writeFileSync(join(cwd, '.next/BUILD_ID'), 'synthetic-build-id\\n')
// Synthetic standalone payload mirroring next build output: server entry, compiled server chunks and static assets.
mkdirSync(join(cwd, '.next/standalone/.next/server'), { recursive: true })
mkdirSync(join(cwd, '.next/static/chunks'), { recursive: true })
writeFileSync(join(cwd, '.next/standalone/server.js'), '// synthetic standalone server\\n')
writeFileSync(
  join(cwd, '.next/standalone/.next/required-server-files.json'),
  readFileSync(join(cwd, '.next/required-server-files.json'))
)
writeFileSync(join(cwd, '.next/standalone/.next/BUILD_ID'), 'synthetic-build-id\\n')
writeFileSync(join(cwd, '.next/standalone/.next/server/app.js'), '// synthetic compiled app route\\n')
writeFileSync(join(cwd, '.next/static/chunks/main.js'), '// synthetic client chunk\\n')
// Traced runtime dependency, as Next copies it into the standalone node_modules.
mkdirSync(join(cwd, '.next/standalone/node_modules/synthetic-pkg'), { recursive: true })
writeFileSync(
  join(cwd, '.next/standalone/node_modules/synthetic-pkg/package.json'),
  JSON.stringify({ name: 'synthetic-pkg', version: '1.0.0', license: 'MIT' })
)
writeFileSync(join(cwd, '.next/standalone/node_modules/synthetic-pkg/index.js'), 'module.exports = 1\\n')
writeFileSync(join(cwd, '.next/standalone/node_modules/synthetic-pkg/LICENSE'), 'Synthetic MIT notice\\n')
if (existsSync(${JSON.stringify(hookScript)})) {
  const mod = await import(pathToFileURL(${JSON.stringify(hookScript)}).href)
  await mod.mutate(cwd)
}
`
  )
  await writeFile(
    join(bin, 'npm'),
    `#!/bin/sh\nexec "${process.execPath}" "${npmRunner}" "$@"\n`
  )
  await chmod(join(bin, 'npm'), 0o755)
  await writeFile(
    join(bin, 'npm.cmd'),
    `@"${process.execPath}" "${npmRunner}" %*\r\n`
  )

  const inheritedPath = process.env.PATH ?? ''
  const runNode = (scriptRelativePath, args = [], { nodeArgs = [] } = {}) =>
    spawnSync(
      process.execPath,
      [...nodeArgs, join(repo, scriptRelativePath), ...args],
      {
        cwd: repo,
        env: cleanGitEnv({
          PATH: [bin, dirname(process.execPath), inheritedPath]
            .filter(Boolean)
            .join(delimiter),
          HOME: home,
          LANG: 'C'
        }),
        encoding: 'utf8',
        timeout: 15000
      }
    )

  return {
    home,
    repo,
    bin,
    npmLog,
    hookScript,
    bundleHookScript,
    runNode,
    lockContents
  }
}

test('build-application refuses modified tracked files, untracked files and dirty lockfiles before running npm', async (t) => {
  const { home, repo, npmLog, runNode, lockContents } =
    await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const recordPath = join(repo, '.next/desktop-build.json')
  await mkdir(join(repo, '.next'), { recursive: true })
  await writeFile(recordPath, '{"stale":true}\n')

  // 1. Tracked source edit refuses before npm runs and clears stale build record.
  await writeFile(
    join(repo, 'app/page.tsx'),
    'export default function Dirty() { return null }\n'
  )
  const dirtyTracked = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(
    dirtyTracked.status,
    0,
    'dirty tracked source must fail closed'
  )
  await assert.rejects(stat(npmLog), { code: 'ENOENT' })
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
  git(repo, ['checkout', '--', 'app/page.tsx'])

  // 2. Untracked non-ignored source file refuses before npm runs.
  await writeFile(join(repo, 'app/untracked.ts'), 'export const stray = 1\n')
  const dirtyUntracked = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(dirtyUntracked.status, 0, 'untracked source must fail closed')
  await assert.rejects(stat(npmLog), { code: 'ENOENT' })
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
  await unlink(join(repo, 'app/untracked.ts'))

  // 3. Uncommitted package-lock.json edit refuses before npm runs.
  await writeFile(join(repo, 'package-lock.json'), lockContents + '\n')
  const dirtyLock = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(
    dirtyLock.status,
    0,
    'dirty package-lock.json must fail closed'
  )
  await assert.rejects(stat(npmLog), { code: 'ENOENT' })
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
  git(repo, ['checkout', '--', 'package-lock.json'])
})

test('build-application refuses mid-build source, lockfile or HEAD mutations before writing desktop-build.json', async (t) => {
  const { home, repo, hookScript, runNode, lockContents } =
    await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))
  const recordPath = join(repo, '.next/desktop-build.json')

  // 1. Source file dirtied during compilation.
  await writeFile(
    hookScript,
    `import { writeFile } from 'node:fs/promises'\nimport { join } from 'node:path'\nexport async function mutate(cwd) {\n  await writeFile(join(cwd, 'app/page.tsx'), '// mutated during build\\n')\n}\n`
  )
  const midDirty = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(midDirty.status, 0, 'mid-build source edit must fail closed')
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
  git(repo, ['checkout', '--', 'app/page.tsx'])

  // 2. Lockfile mutated during compilation.
  await writeFile(
    hookScript,
    `import { writeFile } from 'node:fs/promises'\nimport { join } from 'node:path'\nexport async function mutate(cwd) {\n  await writeFile(join(cwd, 'package-lock.json'), ${JSON.stringify(lockContents + '\n')})\n}\n`
  )
  const midLock = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(midLock.status, 0, 'mid-build lockfile edit must fail closed')
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
  git(repo, ['checkout', '--', 'package-lock.json'])

  // 3. HEAD advanced cleanly during compilation.
  await writeFile(
    hookScript,
    `import { execFileSync } from 'node:child_process'\nimport { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nexport async function mutate(cwd) {\n  writeFileSync(join(cwd, 'app/page.tsx'), '// committed mid-build\\n')\n  execFileSync('git', ['add', 'app/page.tsx'], { cwd })\n  execFileSync('git', ['commit', '-m', 'mid-build commit'], { cwd })\n}\n`
  )
  const midCommit = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(midCommit.status, 0, 'mid-build HEAD change must fail closed')
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
})

test('build-application records exact clean HEAD and lockfile SHA-256 on a clean checkout', async (t) => {
  const { home, repo, npmLog, runNode, lockContents } =
    await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const head = git(repo, ['rev-parse', 'HEAD'])
  const cleanBuild = runNode('apps/desktop/proof/build-application.mjs')
  assert.equal(cleanBuild.status, 0, cleanBuild.stderr)
  assert.deepEqual(JSON.parse(await readFile(npmLog, 'utf8')), ['run', 'build'])
  const record = JSON.parse(
    await readFile(join(repo, '.next/desktop-build.json'), 'utf8')
  )
  assert.equal(record.sourceCommit, head)
  assert.equal(record.packageLockSha256, sha256(lockContents))

  // The record binds the complete packaged payload: standalone tree, static assets and public assets.
  const expectedFiles = []
  for (const [from, to] of [
    ['.next/standalone', ''],
    ['.next/static', '.next/static'],
    ['public', 'public']
  ]) {
    for (const rel of await listFiles(join(repo, from))) {
      const bytes = await readFile(join(repo, from, rel))
      expectedFiles.push({
        path: to ? `${to}/${rel}` : rel,
        bytes: bytes.length,
        sha256: sha256(bytes)
      })
    }
  }
  expectedFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  assert.deepEqual(
    expectedFiles.map((file) => file.path),
    [
      '.next/BUILD_ID',
      '.next/required-server-files.json',
      '.next/server/app.js',
      '.next/static/chunks/main.js',
      'node_modules/synthetic-pkg/LICENSE',
      'node_modules/synthetic-pkg/index.js',
      'node_modules/synthetic-pkg/package.json',
      'public/favicon.svg',
      'server.js'
    ]
  )
  assert.deepEqual(record.applicationFiles, expectedFiles)
  assert.equal(
    record.applicationManifestSha256,
    sha256(JSON.stringify(expectedFiles))
  )
})

test('build-application and stage-linux refuse gitignored source files such as app/api/debug/route.ts while permitting husky and Next build outputs', async (t) => {
  const { home, repo, npmLog, hookScript, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  // Ignored .husky/_ hook files created by npm ci prepare are permitted.
  await mkdir(join(repo, '.husky/_'), { recursive: true })
  await writeFile(join(repo, '.husky/_/.gitignore'), '*\n')
  await writeFile(join(repo, '.husky/_/pre-commit'), '#!/bin/sh\nexit 0\n')

  const recordPath = join(repo, '.next/desktop-build.json')
  await mkdir(join(repo, '.next'), { recursive: true })
  await writeFile(recordPath, '{"stale":true}\n')

  // 1. Gitignored app/api/debug/route.ts is invisible to plain git status --porcelain, yet MUST fail before npm runs.
  await mkdir(join(repo, 'app/api/debug'), { recursive: true })
  await writeFile(
    join(repo, 'app/api/debug/route.ts'),
    'export function GET() { return new Response("debug") }\n'
  )
  assert.equal(
    git(repo, ['status', '--porcelain', '--untracked-files=all']),
    '',
    'sanity: app/api/debug/route.ts matches .gitignore'
  )
  const ignoredPreBuild = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(
    ignoredPreBuild.status,
    0,
    'gitignored app/api/debug/route.ts must fail closed before build'
  )
  await assert.rejects(stat(npmLog), { code: 'ENOENT' })
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
  await rm(join(repo, 'app/api/debug'), { recursive: true, force: true })

  // 2. Gitignored route created during compilation MUST fail closed before writing desktop-build.json.
  await writeFile(
    hookScript,
    `import { mkdir, writeFile } from 'node:fs/promises'\nimport { join } from 'node:path'\nexport async function mutate(cwd) {\n  await mkdir(join(cwd, 'app/api/debug'), { recursive: true })\n  await writeFile(join(cwd, 'app/api/debug/route.ts'), 'export const dynamic = "force-dynamic"\\n')\n}\n`
  )
  const ignoredMidBuild = runNode('apps/desktop/proof/build-application.mjs')
  assert.notEqual(
    ignoredMidBuild.status,
    0,
    'gitignored route created mid-build must fail closed'
  )
  await assert.rejects(stat(recordPath), { code: 'ENOENT' })
  await rm(join(repo, 'app/api/debug'), { recursive: true, force: true })
  await unlink(hookScript)

  // 3. Clean build with .husky/_ present and generated next-env.d.ts / tsconfig.tsbuildinfo succeeds (including rebuild).
  await writeFile(join(repo, 'next-env.d.ts'), '// generated by next\n')
  await writeFile(join(repo, 'tsconfig.tsbuildinfo'), '{}\n')
  const cleanBuild = runNode('apps/desktop/proof/build-application.mjs')
  assert.equal(cleanBuild.status, 0, cleanBuild.stderr)
  await writeFile(join(repo, 'next-env.d.ts'), '// generated by next\n')
  await writeFile(join(repo, 'tsconfig.tsbuildinfo'), '{}\n')

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  const baseConfig = await createStageInputs(home, repo)

  // 4. Gitignored files in the packaging checkout (app/api/debug/route.ts or *.bak in packaged dirs) refuse before mkdir(output).
  await mkdir(join(repo, 'app/api/debug'), { recursive: true })
  await writeFile(
    join(repo, 'app/api/debug/route.ts'),
    'export function GET() { return null }\n'
  )
  const outIgnoredRoute = join(home, 'out-ignored-route')
  const cfgIgnoredRoute = join(home, 'stage-ignored-route.json')
  await writeFile(
    cfgIgnoredRoute,
    JSON.stringify({
      ...baseConfig,
      output: outIgnoredRoute,
      sourceCommit: commitA
    })
  )
  const stageIgnoredRoute = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgIgnoredRoute
  ])
  assert.notEqual(
    stageIgnoredRoute.status,
    0,
    'stage-linux must refuse gitignored app/api/debug/route.ts'
  )
  await assert.rejects(stat(outIgnoredRoute), { code: 'ENOENT' })
  await rm(join(repo, 'app/api/debug'), { recursive: true, force: true })

  await writeFile(
    join(repo, 'apps/desktop/launcher/launch.mjs.bak'),
    '// ignored backup inside packaged launcher directory\n'
  )
  const outIgnoredBak = join(home, 'out-ignored-bak')
  const cfgIgnoredBak = join(home, 'stage-ignored-bak.json')
  await writeFile(
    cfgIgnoredBak,
    JSON.stringify({
      ...baseConfig,
      output: outIgnoredBak,
      sourceCommit: commitA
    })
  )
  const stageIgnoredBak = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgIgnoredBak
  ])
  assert.notEqual(
    stageIgnoredBak.status,
    0,
    'stage-linux must refuse gitignored *.bak inside packaged launcher dir'
  )
  await assert.rejects(stat(outIgnoredBak), { code: 'ENOENT' })
  await unlink(join(repo, 'apps/desktop/launcher/launch.mjs.bak'))
})

async function listFiles(root, prefix = '') {
  const out = []
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true
  })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listFiles(root, rel)))
    else out.push(rel)
  }
  return out
}

async function createStageInputs(home, repo, name = 'stage-inputs') {
  const inputs = join(home, name)
  const application = join(inputs, 'application')
  const postgres = join(inputs, 'postgres')
  const electron = join(inputs, 'electron')
  const auth = join(inputs, 'auth')
  // The real standalone stager builds the application, including application-notices.json.
  const staged = spawnSync(
    process.execPath,
    [join(repo, 'apps/desktop/proof/stage-standalone.mjs'), application],
    {
      cwd: repo,
      env: cleanGitEnv({ HOME: home, LANG: 'C' }),
      encoding: 'utf8',
      timeout: 15000
    }
  )
  assert.equal(staged.status, 0, staged.stderr)
  await cp(
    join(repo, 'package-lock.json'),
    join(application, 'package-lock.json')
  )

  await mkdir(postgres, { recursive: true })
  await writeFile(join(postgres, 'COPYRIGHT'), 'Synthetic PostgreSQL notice\n')
  await mkdir(electron, { recursive: true })
  await writeFile(join(electron, 'LICENSE'), 'Synthetic Electron notice\n')
  await writeFile(
    join(electron, 'LICENSES.chromium.html'),
    '<html>Synthetic Chromium notice</html>\n'
  )
  await mkdir(join(auth, 'migrations'), { recursive: true })
  await writeFile(join(auth, 'auth'), '#!/bin/sh\nexit 0\n')
  await writeFile(join(auth, 'migrations/001.sql'), 'SELECT 1;\n')

  const files = {
    node: join(inputs, 'node'),
    postgrest: join(inputs, 'postgrest'),
    runtimeGuard: join(inputs, 'runtime-guard'),
    nodeLicense: join(inputs, 'node-LICENSE'),
    authLicense: join(inputs, 'auth-LICENSE'),
    postgrestLicense: join(inputs, 'postgrest-LICENSE')
  }
  for (const [key, path] of Object.entries(files)) {
    await writeFile(path, `Synthetic ${key} payload\n`)
  }
  return {
    application,
    postgres,
    electron,
    auth,
    ...files
  }
}

test('stage-linux refuses mixed-source packaging when checkout HEAD differs from configured sourceCommit or build record', async (t) => {
  const { home, repo, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const baseConfig = await createStageInputs(home, repo)

  // Advance packaging checkout to commit B without changing package-lock.json.
  await writeFile(
    join(repo, 'apps/desktop/launcher/launch.mjs'),
    'export const version = "b"\n'
  )
  git(repo, ['add', 'apps/desktop/launcher/launch.mjs'])
  git(repo, ['commit', '-m', 'synthetic launcher update'])
  const commitB = git(repo, ['rev-parse', 'HEAD'])
  assert.notEqual(commitA, commitB)

  // 1. config.sourceCommit = commitA while packaging checkout is commitB -> MUST refuse before mkdir(output).
  const outConfigMismatch = join(home, 'out-config-mismatch')
  const cfgPath1 = join(home, 'stage-1.json')
  await writeFile(
    cfgPath1,
    JSON.stringify({
      ...baseConfig,
      output: outConfigMismatch,
      sourceCommit: commitA
    })
  )
  const res1 = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath1])
  assert.notEqual(
    res1.status,
    0,
    'mismatched config.sourceCommit must fail closed'
  )
  await assert.rejects(stat(outConfigMismatch), { code: 'ENOENT' })

  // 2. --source-commit commitA on CLI while packaging checkout is commitB -> MUST refuse before mkdir(output).
  const outFlagMismatch = join(home, 'out-flag-mismatch')
  const cfgPath2 = join(home, 'stage-2.json')
  await writeFile(
    cfgPath2,
    JSON.stringify({ ...baseConfig, output: outFlagMismatch })
  )
  const res2 = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgPath2,
    '--source-commit',
    commitA
  ])
  assert.notEqual(
    res2.status,
    0,
    'mismatched --source-commit flag must fail closed'
  )
  await assert.rejects(stat(outFlagMismatch), { code: 'ENOENT' })

  // 3. Omitted sourceCommit uses checkout HEAD (commitB), which disagrees with build record (commitA).
  const outRecordMismatch = join(home, 'out-record-mismatch')
  const cfgPath3 = join(home, 'stage-3.json')
  await writeFile(
    cfgPath3,
    JSON.stringify({ ...baseConfig, output: outRecordMismatch })
  )
  const res3 = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath3])
  assert.notEqual(
    res3.status,
    0,
    'build record vs checkout HEAD mismatch must fail closed'
  )
  await assert.rejects(stat(outRecordMismatch), { code: 'ENOENT' })

  // 4. Conflicting config.sourceCommit vs --source-commit refuses before mkdir(output).
  const outConflict = join(home, 'out-conflict')
  const cfgPath4 = join(home, 'stage-4.json')
  await writeFile(
    cfgPath4,
    JSON.stringify({
      ...baseConfig,
      output: outConflict,
      sourceCommit: commitB
    })
  )
  const res4 = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgPath4,
    `--source-commit=${commitA}`
  ])
  assert.notEqual(
    res4.status,
    0,
    'conflicting CLI and JSON sourceCommit must fail closed'
  )
  await assert.rejects(stat(outConflict), { code: 'ENOENT' })
})

test('stage-linux refuses dirty tracked, untracked or automatic env files in the packaging checkout before creating output', async (t) => {
  const { home, repo, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const baseConfig = await createStageInputs(home, repo)

  // 1. Dirty tracked launcher edit in packaging checkout.
  await writeFile(
    join(repo, 'apps/desktop/launcher/launch.mjs'),
    'export const version = "dirty"\n'
  )
  const outDirtyTracked = join(home, 'out-dirty-tracked')
  const cfgTracked = join(home, 'stage-dirty-tracked.json')
  await writeFile(
    cfgTracked,
    JSON.stringify({
      ...baseConfig,
      output: outDirtyTracked,
      sourceCommit: commitA
    })
  )
  const resTracked = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgTracked
  ])
  assert.notEqual(
    resTracked.status,
    0,
    'dirty tracked packaging checkout must fail closed'
  )
  await assert.rejects(stat(outDirtyTracked), { code: 'ENOENT' })
  git(repo, ['checkout', '--', 'apps/desktop/launcher/launch.mjs'])

  // 2. Untracked file in packaging checkout.
  await writeFile(
    join(repo, 'apps/desktop/launcher/untracked.mjs'),
    'export const x = 1\n'
  )
  const outDirtyUntracked = join(home, 'out-dirty-untracked')
  const cfgUntracked = join(home, 'stage-dirty-untracked.json')
  await writeFile(
    cfgUntracked,
    JSON.stringify({
      ...baseConfig,
      output: outDirtyUntracked,
      sourceCommit: commitA
    })
  )
  const resUntracked = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgUntracked
  ])
  assert.notEqual(
    resUntracked.status,
    0,
    'untracked packaging file must fail closed'
  )
  await assert.rejects(stat(outDirtyUntracked), { code: 'ENOENT' })
  await unlink(join(repo, 'apps/desktop/launcher/untracked.mjs'))

  // 3. Ignored automatic .env.local in packaging checkout refuses before output creation.
  await writeFile(join(repo, '.env.local'), 'SYNTHETIC_PLACEHOLDER=1\n')
  const outDirtyEnv = join(home, 'out-dirty-env')
  const cfgEnv = join(home, 'stage-dirty-env.json')
  await writeFile(
    cfgEnv,
    JSON.stringify({
      ...baseConfig,
      output: outDirtyEnv,
      sourceCommit: commitA
    })
  )
  const resEnv = runNode('apps/desktop/package/stage-linux.mjs', [cfgEnv])
  assert.notEqual(
    resEnv.status,
    0,
    'automatic env file in packaging checkout must fail closed'
  )
  await assert.rejects(stat(outDirtyEnv), { code: 'ENOENT' })
  await unlink(join(repo, '.env.local'))
})

test('stage-linux stages a clean matching checkout and records exact provenance in SBOM and inventory', async (t) => {
  const { home, repo, runNode, lockContents } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  const expectedLockHash = sha256(lockContents)
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const baseConfig = await createStageInputs(home, repo)

  for (const [label, extraCfg, cliArgs] of [
    ['explicit', { sourceCommit: commitA }, ['--source-commit', commitA]],
    ['implicit-head', {}, []]
  ]) {
    const outDir = join(home, `out-clean-${label}`)
    const cfgPath = join(home, `stage-clean-${label}.json`)
    await writeFile(
      cfgPath,
      JSON.stringify({ ...baseConfig, output: outDir, ...extraCfg })
    )
    const res = runNode('apps/desktop/package/stage-linux.mjs', [
      cfgPath,
      ...cliArgs
    ])
    assert.equal(res.status, 0, res.stderr)

    const inventory = JSON.parse(
      await readFile(join(outDir, 'package-inventory.json'), 'utf8')
    )
    assert.equal(inventory.sourceCommit, commitA)
    assert.equal(inventory.packageLockSha256, expectedLockHash)

    const sbom = JSON.parse(
      await readFile(join(outDir, 'sbom.cdx.json'), 'utf8')
    )
    const props = Object.fromEntries(
      sbom.metadata.properties.map(({ name, value }) => [name, value])
    )
    assert.equal(props.sourceCommit, commitA)
    assert.equal(props.packageLockSha256, expectedLockHash)

    // The real stager's generated notice inventory is packaged and bound to its notice files.
    const notices = JSON.parse(
      await readFile(
        join(outDir, 'application/application-notices.json'),
        'utf8'
      )
    )
    assert.deepEqual(
      notices.packages.map((entry) => [
        entry.packagePath,
        entry.status,
        entry.notices.map((notice) => [notice.path, notice.origin])
      ]),
      [
        [
          'synthetic-pkg',
          'notices-preserved',
          [
            ['third-party-notices/synthetic-pkg/LICENSE', 'traced-package'],
            [
              'third-party-notices/synthetic-pkg/NOTICE',
              'installed-source-package'
            ]
          ]
        ]
      ]
    )
    const packaged = new Set(inventory.files.map((file) => file.path))
    for (const path of [
      'application/application-notices.json',
      'application/third-party-notices/synthetic-pkg/LICENSE',
      'application/third-party-notices/synthetic-pkg/NOTICE'
    ])
      assert.ok(packaged.has(path), `${label}: ${path} must be packaged`)
  }
})

test('stage-linux refuses a tampered generated notice inventory from the real standalone stager', async (t) => {
  const { home, repo, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const edit = (change) => async (app) => {
    const path = join(app, 'application-notices.json')
    const inventory = JSON.parse(await readFile(path, 'utf8'))
    change(inventory)
    await writeFile(path, JSON.stringify(inventory, null, 2))
  }
  for (const [label, tamper, message] of [
    [
      'notice-digest',
      edit((inventory) => {
        inventory.packages[0].notices[0].sha256 = 'a'.repeat(64)
      }),
      /notice inventory does not match staged notice/
    ],
    [
      'unlisted-notice-file',
      async (app) =>
        writeFile(
          join(app, 'third-party-notices/synthetic-pkg/COPYING'),
          'Unlisted notice\n'
        ),
      /Unlisted application notice/
    ],
    [
      'invented-package',
      edit((inventory) => {
        inventory.packages.push({
          ...inventory.packages[0],
          packagePath: 'invented-pkg',
          notices: []
        })
      }),
      /notice inventory package set/
    ],
    [
      'notice-outside-package',
      edit((inventory) => {
        inventory.packages[0].notices[0].path = 'server.js'
      }),
      /notice inventory path/
    ],
    [
      'non-canonical-bytes',
      async (app) => {
        const path = join(app, 'application-notices.json')
        await writeFile(path, (await readFile(path, 'utf8')) + '\n')
      },
      /notice inventory is not canonical/
    ],
    [
      'missing-inventory',
      async (app) => unlink(join(app, 'application-notices.json')),
      /application-notices\.json is missing/
    ]
  ]) {
    const config = await createStageInputs(home, repo, `inputs-${label}`)
    await tamper(config.application)
    const out = join(home, `out-${label}`)
    const cfgPath = join(home, `stage-${label}.json`)
    await writeFile(
      cfgPath,
      JSON.stringify({ ...config, output: out, sourceCommit: commitA })
    )
    const res = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath])
    assert.notEqual(res.status, 0, `${label}: must fail closed`)
    assert.match(res.stderr, message, label)
    await assert.rejects(stat(out), { code: 'ENOENT' }, label)
  }
})

test('stage-linux revalidates the copied application after native bundling and refuses swapped builds before publishing inventory', async (t) => {
  const { home, repo, bundleHookScript, runNode, lockContents } =
    await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const baseConfig = await createStageInputs(home, repo)
  const cleanRecordRaw = await readFile(
    join(baseConfig.application, 'desktop-build.json'),
    'utf8'
  )
  const swappedRecordRaw = JSON.stringify(
    { ...JSON.parse(cleanRecordRaw), sourceCommit: 'b'.repeat(40) },
    null,
    2
  )

  // 1. Replace config.application build records with build B during buildNativeAddons.
  await writeFile(
    bundleHookScript,
    `import { writeFile } from 'node:fs/promises'
export async function mutate() {
  await writeFile(${JSON.stringify(join(baseConfig.application, 'desktop-build.json'))}, ${JSON.stringify(swappedRecordRaw)})
  await writeFile(${JSON.stringify(join(baseConfig.application, '.next/desktop-build.json'))}, ${JSON.stringify(swappedRecordRaw)})
}
`
  )
  const outSwappedBuild = join(home, 'out-swapped-build')
  const cfgSwappedBuild = join(home, 'stage-swapped-build.json')
  await writeFile(
    cfgSwappedBuild,
    JSON.stringify({
      ...baseConfig,
      output: outSwappedBuild,
      sourceCommit: commitA
    })
  )
  const resSwappedBuild = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgSwappedBuild
  ])
  assert.notEqual(
    resSwappedBuild.status,
    0,
    'swapping config.application to build B during bundling must fail closed'
  )
  await assert.rejects(stat(join(outSwappedBuild, 'package-inventory.json')), {
    code: 'ENOENT'
  })

  // 2. Restore build A records; test swapping only nested .next/desktop-build.json during bundling.
  await writeFile(
    join(baseConfig.application, 'desktop-build.json'),
    cleanRecordRaw
  )
  await writeFile(
    join(baseConfig.application, '.next/desktop-build.json'),
    cleanRecordRaw
  )
  await writeFile(
    bundleHookScript,
    `import { writeFile } from 'node:fs/promises'
export async function mutate() {
  await writeFile(${JSON.stringify(join(baseConfig.application, '.next/desktop-build.json'))}, ${JSON.stringify(swappedRecordRaw)})
}
`
  )
  const outSwappedNested = join(home, 'out-swapped-nested')
  const cfgSwappedNested = join(home, 'stage-swapped-nested.json')
  await writeFile(
    cfgSwappedNested,
    JSON.stringify({
      ...baseConfig,
      output: outSwappedNested,
      sourceCommit: commitA
    })
  )
  const resSwappedNested = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgSwappedNested
  ])
  assert.notEqual(
    resSwappedNested.status,
    0,
    'swapping nested .next/desktop-build.json during bundling must fail closed'
  )
  await assert.rejects(stat(join(outSwappedNested, 'package-inventory.json')), {
    code: 'ENOENT'
  })

  // 3. Restore nested record; test mutating config.application/package-lock.json during bundling.
  await writeFile(
    join(baseConfig.application, '.next/desktop-build.json'),
    cleanRecordRaw
  )
  await writeFile(
    bundleHookScript,
    `import { writeFile } from 'node:fs/promises'
export async function mutate() {
  await writeFile(${JSON.stringify(join(baseConfig.application, 'package-lock.json'))}, ${JSON.stringify(lockContents + '\n')})
}
`
  )
  const outSwappedLock = join(home, 'out-swapped-lock')
  const cfgSwappedLock = join(home, 'stage-swapped-lock.json')
  await writeFile(
    cfgSwappedLock,
    JSON.stringify({
      ...baseConfig,
      output: outSwappedLock,
      sourceCommit: commitA
    })
  )
  const resSwappedLock = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgSwappedLock
  ])
  assert.notEqual(
    resSwappedLock.status,
    0,
    'mutating config.application/package-lock.json during bundling must fail closed'
  )
  await assert.rejects(stat(join(outSwappedLock, 'package-inventory.json')), {
    code: 'ENOENT'
  })
})

async function snapshotRecords(application) {
  const snapshot = {}
  for (const rel of [
    'desktop-build.json',
    '.next/required-server-files.json',
    '.next/BUILD_ID',
    'package-lock.json'
  ])
    snapshot[rel] = sha256(await readFile(join(application, rel)))
  return snapshot
}

test('stage-linux binds the complete application payload and refuses payload-only replacement during native bundling', async (t) => {
  const { home, repo, bundleHookScript, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)

  const cases = [
    [
      'replaced-server',
      `await writeFile(join(app, 'server.js'), '// replaced standalone server\\n')`
    ],
    [
      'replaced-next-server',
      `await writeFile(join(app, '.next/server/app.js'), '// replaced compiled route\\n')`
    ],
    [
      'extra-next-server',
      `await writeFile(join(app, '.next/server/injected.js'), '// injected route\\n')`
    ],
    [
      'missing-static',
      `await unlink(join(app, '.next/static/chunks/main.js'))`
    ],
    [
      'symlinked-server',
      `const decoy = join(app, '..', 'decoy-server.js')
  await writeFile(decoy, await readFile(join(app, 'server.js')))
  await unlink(join(app, 'server.js'))
  await symlink(decoy, join(app, 'server.js'))`
    ]
  ]
  for (const [label, mutation] of cases) {
    const config = await createStageInputs(home, repo, `inputs-${label}`)
    const app = config.application
    const before = await snapshotRecords(app)
    await writeFile(
      bundleHookScript,
      `import { readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export async function mutate() {
  const app = ${JSON.stringify(app)}
  ${mutation}
}
`
    )
    const out = join(home, `out-${label}`)
    const cfgPath = join(home, `stage-${label}.json`)
    await writeFile(
      cfgPath,
      JSON.stringify({ ...config, output: out, sourceCommit: commitA })
    )
    const res = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath])
    // Payload-only: every build record, required-server-files, BUILD_ID and lockfile stayed byte-identical.
    assert.deepEqual(await snapshotRecords(app), before, label)
    assert.notEqual(
      res.status,
      0,
      `${label}: payload-only application change during bundling must fail closed`
    )
    await assert.rejects(stat(out), { code: 'ENOENT' }, label)
  }
  await unlink(bundleHookScript)

  // A symlink planted before staging is refused before output creation.
  const linked = await createStageInputs(home, repo, 'inputs-prelinked')
  const decoy = join(home, 'decoy-app.js')
  await writeFile(
    decoy,
    await readFile(join(linked.application, '.next/server/app.js'))
  )
  await unlink(join(linked.application, '.next/server/app.js'))
  await symlink(decoy, join(linked.application, '.next/server/app.js'))
  const outLinked = join(home, 'out-prelinked')
  const cfgLinked = join(home, 'stage-prelinked.json')
  await writeFile(
    cfgLinked,
    JSON.stringify({ ...linked, output: outLinked, sourceCommit: commitA })
  )
  const resLinked = runNode('apps/desktop/package/stage-linux.mjs', [cfgLinked])
  assert.notEqual(resLinked.status, 0, 'symlinked application entry must fail')
  await assert.rejects(stat(outLinked), { code: 'ENOENT' })

  // Control: the untouched payload stages, and every application file is in the inventory.
  const clean = await createStageInputs(home, repo, 'inputs-clean')
  const outClean = join(home, 'out-payload-clean')
  const cfgClean = join(home, 'stage-payload-clean.json')
  await writeFile(
    cfgClean,
    JSON.stringify({ ...clean, output: outClean, sourceCommit: commitA })
  )
  const resClean = runNode('apps/desktop/package/stage-linux.mjs', [cfgClean])
  assert.equal(resClean.status, 0, resClean.stderr)
  const inventory = JSON.parse(
    await readFile(join(outClean, 'package-inventory.json'), 'utf8')
  )
  const appEntries = inventory.files
    .filter((file) => file.path.startsWith('application/'))
    .map((file) => file.path.slice('application/'.length))
    .sort()
  assert.deepEqual(appEntries, (await listFiles(clean.application)).sort())
})

test('stage-linux acquires its output directory exclusively and never removes a directory it did not create', async (t) => {
  const { home, repo, bundleHookScript, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const baseConfig = await createStageInputs(home, repo)

  // 1. Output already present before staging starts.
  const outExisting = join(home, 'out-existing')
  await mkdir(outExisting)
  await writeFile(join(outExisting, 'owner.txt'), 'other invocation\n')
  const cfgExisting = join(home, 'stage-existing.json')
  await writeFile(
    cfgExisting,
    JSON.stringify({
      ...baseConfig,
      output: outExisting,
      sourceCommit: commitA
    })
  )
  const resExisting = runNode('apps/desktop/package/stage-linux.mjs', [
    cfgExisting
  ])
  assert.notEqual(resExisting.status, 0, 'existing output must fail closed')
  assert.deepEqual(await readdir(outExisting), ['owner.txt'])

  // 2. A concurrent invocation creates the output between any absence check and acquisition.
  for (const [label, failBundling] of [
    ['race-success', false],
    ['race-failure', true]
  ]) {
    const out = join(home, `out-${label}`)
    const preload = join(home, `preload-${label}.mjs`)
    await writeFile(
      preload,
      `import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join, resolve } from 'node:path'
const original = fsp.mkdir
fsp.mkdir = async (path, options) => {
  if (resolve(String(path)) === ${JSON.stringify(out)}) {
    await original(path)
    await fsp.writeFile(join(path, 'owner.txt'), 'other invocation\\n')
  }
  return original(path, options)
}
syncBuiltinESMExports()
`
    )
    if (failBundling)
      await writeFile(
        bundleHookScript,
        `export async function mutate() { throw new Error('synthetic bundling failure') }\n`
      )
    const cfgPath = join(home, `stage-${label}.json`)
    await writeFile(
      cfgPath,
      JSON.stringify({ ...baseConfig, output: out, sourceCommit: commitA })
    )
    const res = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath], {
      nodeArgs: ['--import', preload]
    })
    if (failBundling) await unlink(bundleHookScript)
    assert.notEqual(
      res.status,
      0,
      `${label}: concurrently created output must fail closed`
    )
    assert.deepEqual(
      await readdir(out),
      ['owner.txt'],
      `${label}: the other invocation's output must survive untouched`
    )
  }
})

test('stage-linux refuses output paths with symlinked or missing parent components', async (t) => {
  const { home, repo, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const baseConfig = await createStageInputs(home, repo)

  const realParent = join(home, 'real-parent')
  await mkdir(join(realParent, 'nested'), { recursive: true })
  await symlink(realParent, join(home, 'link-parent'))
  for (const [label, output, mustNotExist] of [
    [
      'symlink-parent',
      join(home, 'link-parent', 'out'),
      join(realParent, 'out')
    ],
    [
      'symlink-ancestor',
      join(home, 'link-parent', 'nested', 'out'),
      join(realParent, 'nested', 'out')
    ],
    ['missing-parent', join(home, 'missing', 'out'), join(home, 'missing')]
  ]) {
    const cfgPath = join(home, `stage-${label}.json`)
    await writeFile(
      cfgPath,
      JSON.stringify({ ...baseConfig, output, sourceCommit: commitA })
    )
    const res = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath])
    assert.notEqual(res.status, 0, `${label}: output path must be refused`)
    await assert.rejects(stat(mustNotExist), { code: 'ENOENT' }, label)
  }
})

// Runs stage-linux with a swap injected at one point and asserts cleanup never deletes through it.
test('stage-linux cleanup refuses to delete through a replaced parent or a replaced output directory', async (t) => {
  const { home, repo, bundleHookScript, runNode } = await createTempCheckout()
  t.after(() => rm(home, { recursive: true, force: true }))

  const commitA = git(repo, ['rev-parse', 'HEAD'])
  assert.equal(runNode('apps/desktop/proof/build-application.mjs').status, 0)
  const baseConfig = await createStageInputs(home, repo)

  // Each swap leaves a victim directory with one sentinel; the victim must survive untouched.
  const swaps = {
    'parent-symlink': (parent, out, victim) => `
  await fsp.rename(${JSON.stringify(parent)}, ${JSON.stringify(parent + '-moved')})
  await fsp.mkdir(${JSON.stringify(join(victim, 'out'))}, { recursive: true })
  await fsp.writeFile(${JSON.stringify(join(victim, 'out', 'owner.txt'))}, 'victim\\n')
  await fsp.symlink(${JSON.stringify(victim)}, ${JSON.stringify(parent)})`,
    'output-directory': (_parent, out) => `
  await fsp.rename(${JSON.stringify(out)}, ${JSON.stringify(out + '-moved')})
  await fsp.mkdir(${JSON.stringify(out)})
  await fsp.writeFile(${JSON.stringify(join(out, 'owner.txt'))}, 'victim\\n')`,
    'output-symlink': (parent, out, victim) => `
  await fsp.rename(${JSON.stringify(out)}, ${JSON.stringify(out + '-moved')})
  await fsp.mkdir(${JSON.stringify(victim)}, { recursive: true })
  await fsp.writeFile(${JSON.stringify(join(victim, 'owner.txt'))}, 'victim\\n')
  await fsp.symlink(${JSON.stringify(victim)}, ${JSON.stringify(out)})`
  }
  const victimOf = {
    'parent-symlink': (victim) => join(victim, 'out'),
    'output-directory': (victim, out) => out,
    'output-symlink': (victim) => victim
  }

  const outcomes = []
  for (const when of ['after-acquisition', 'during-bundling']) {
    for (const [kind, swap] of Object.entries(swaps)) {
      const label = `${when}-${kind}`
      const parent = join(home, `parent-${label}`)
      const out = join(parent, 'out')
      const victim = join(home, `victim-${label}`)
      await mkdir(parent)
      const nodeArgs = []
      if (when === 'after-acquisition') {
        // Swap immediately after this invocation's own mkdir of the output succeeds.
        const preload = join(home, `preload-${label}.mjs`)
        await writeFile(
          preload,
          `import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'
const original = fsp.mkdir
let swapped = false
fsp.mkdir = async (path, options) => {
  const result = await original(path, options)
  if (!swapped && resolve(String(path)) === ${JSON.stringify(out)}) {
    swapped = true
${swap(parent, out, victim)}
  }
  return result
}
syncBuiltinESMExports()
`
        )
        nodeArgs.push('--import', preload)
      }
      // Bundling always fails so the cleanup path runs.
      await writeFile(
        bundleHookScript,
        `import fsp from 'node:fs/promises'
export async function mutate() {
${when === 'during-bundling' ? swap(parent, out, victim) : ''}
  throw new Error('synthetic bundling failure')
}
`
      )
      const cfgPath = join(home, `stage-${label}.json`)
      await writeFile(
        cfgPath,
        JSON.stringify({ ...baseConfig, output: out, sourceCommit: commitA })
      )
      const res = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath], {
        nodeArgs
      })
      await unlink(bundleHookScript).catch(() => {})
      // Collect every interleaving's outcome so one run reports all of them.
      const survivor = await readdir(victimOf[kind](victim, out)).catch(
        (error) => error.code
      )
      outcomes.push([
        label,
        res.status !== 0,
        survivor,
        /Refusing to remove package output/.test(res.stderr)
      ])
    }
  }
  assert.deepEqual(
    outcomes,
    outcomes.map(([label]) => [label, true, ['owner.txt'], true]),
    '[label, staging failed, replacement contents, cleanup refused]'
  )

  // Control: an unswapped failure still removes the output this invocation created.
  const parent = join(home, 'parent-control')
  const out = join(parent, 'out')
  await mkdir(parent)
  await writeFile(
    bundleHookScript,
    `export async function mutate() { throw new Error('synthetic bundling failure') }\n`
  )
  const cfgPath = join(home, 'stage-control.json')
  await writeFile(
    cfgPath,
    JSON.stringify({ ...baseConfig, output: out, sourceCommit: commitA })
  )
  const res = runNode('apps/desktop/package/stage-linux.mjs', [cfgPath])
  await unlink(bundleHookScript)
  assert.notEqual(res.status, 0)
  assert.doesNotMatch(res.stderr, /Refusing to remove package output/)
  assert.deepEqual(await readdir(parent), [])
})
