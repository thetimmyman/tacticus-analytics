import {
  cp,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir
} from 'node:fs/promises'
import { resolve, join, dirname, isAbsolute, parse, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  captureCleanCheckoutProvenance,
  requireCleanBuildEnvironment,
  verifyRecordedDesktopBuild,
  verifyApplicationLockfile,
  verifyApplicationPayload
} from './build-profile.mjs'
import { updateConfiguration } from '../launcher/updates.mjs'
import { buildNativeAddons } from '../../addons/build-native.mjs'
import { generateSbom } from './generate-sbom.mjs'
import { evaluate as scanInventory } from '../../../scripts/security/scan-release-artifact.mjs'

function parseCliArgs(argv) {
  let configPath
  let cliSourceCommit
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--source-commit') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--'))
        throw new Error('Explicit 40-character sourceCommit required')
      if (cliSourceCommit !== undefined && cliSourceCommit !== next)
        throw new Error('Conflicting --source-commit arguments')
      cliSourceCommit = next
      i += 1
    } else if (arg.startsWith('--source-commit=')) {
      const value = arg.slice('--source-commit='.length)
      if (cliSourceCommit !== undefined && cliSourceCommit !== value)
        throw new Error('Conflicting --source-commit arguments')
      cliSourceCommit = value
    } else if (arg.startsWith('--')) {
      throw new Error(`Unsupported stage-linux flag: ${arg}`)
    } else if (configPath === undefined) {
      configPath = arg
    } else {
      throw new Error('Unexpected positional argument for stage-linux')
    }
  }
  if (!configPath) throw new Error('Staging configuration path required')
  return { configPath, cliSourceCommit }
}

async function verifyStagedApplication(appDir, expectedProvenance) {
  const recordPath = join(appDir, 'desktop-build.json')
  const record = await verifyRecordedDesktopBuild(
    appDir,
    recordPath,
    expectedProvenance
  )
  const nestedRecordPath = join(appDir, '.next/desktop-build.json')
  const nestedRecord = await readFile(nestedRecordPath).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (nestedRecord !== null) {
    await verifyRecordedDesktopBuild(
      appDir,
      nestedRecordPath,
      expectedProvenance
    )
    if (!nestedRecord.equals(await readFile(recordPath)))
      throw new Error(
        'Nested desktop build record disagrees with the root record'
      )
  }
  await verifyApplicationLockfile(appDir, expectedProvenance.packageLockSha256)
  // Every file is re-hashed against the payload manifest bound at build time.
  const digests = await verifyApplicationPayload(appDir, record)
  return { record, digests }
}

function sameDigests(left, right) {
  if (left.size !== right.size) return false
  for (const [key, value] of left.entries()) {
    if (right.get(key) !== value) return false
  }
  return true
}

// Every existing component above the output must be a real directory, never a symlink.
async function requireRealOutputParent(output) {
  if (resolve(output) !== output)
    throw new Error('Normalized absolute output path required')
  const { root } = parse(output)
  const parent = dirname(output)
  if (parent === output) throw new Error('Output must not be a filesystem root')
  let current = root
  for (const part of parent.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error('Package output parent directory must already exist')
      throw error
    }
    if (info.isSymbolicLink())
      throw new Error('Package output path must not traverse a symlink')
    if (!info.isDirectory())
      throw new Error('Package output parent must be a directory')
  }
}

const { configPath, cliSourceCommit } = parseCliArgs(process.argv.slice(2))
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
await requireCleanBuildEnvironment(source)
const checkoutProvenance = await captureCleanCheckoutProvenance(source, {
  allowBuildOutputs: true
})
const lockRaw = checkoutProvenance.lockBytes
const sourceLockSha256 = checkoutProvenance.packageLockSha256
const config = JSON.parse(await readFile(configPath, 'utf8'))
for (const name of [
  'output',
  'application',
  'postgres',
  'node',
  'electron',
  'auth',
  'postgrest',
  'runtimeGuard',
  'nodeLicense',
  'authLicense',
  'postgrestLicense'
])
  if (!isAbsolute(config[name] || ''))
    throw new Error(`Absolute ${name} path required`)
for (const candidate of [cliSourceCommit, config.sourceCommit]) {
  if (
    candidate !== undefined &&
    (typeof candidate !== 'string' || !/^[a-f0-9]{40}$/.test(candidate))
  )
    throw new Error('Explicit 40-character sourceCommit required')
}
if (
  cliSourceCommit !== undefined &&
  config.sourceCommit !== undefined &&
  cliSourceCommit !== config.sourceCommit
)
  throw new Error('Configured sourceCommit and --source-commit must match')
const configuredCommit = cliSourceCommit ?? config.sourceCommit
if (
  configuredCommit !== undefined &&
  configuredCommit !== checkoutProvenance.sourceCommit
)
  throw new Error(
    'Configured sourceCommit does not match packaging checkout HEAD'
  )
const sourceCommit = checkoutProvenance.sourceCommit
const expectedProvenance = {
  sourceCommit,
  packageLockSha256: sourceLockSha256
}
await requireRealOutputParent(config.output)
const { record: buildRecord, digests: initialAppDigests } =
  await verifyStagedApplication(config.application, expectedProvenance)
await requireRealOutputParent(config.output)
// Atomic single-directory acquisition: EEXIST means another owner, so fail without touching it.
let createdOutputDir = false
try {
  await mkdir(config.output, { mode: 0o700 })
} catch (error) {
  if (error.code === 'EEXIST') throw new Error('Package output already exists')
  throw error
}
createdOutputDir = true
try {
  await requireRealOutputParent(config.output)
  await buildNativeAddons(join(config.output, 'apps/desktop/addons'))
  if (config.addonPolicy && !isAbsolute(config.addonPolicy))
    throw new Error('Absolute add-on policy path required')
  await cp(
    config.addonPolicy ??
      join(source, 'apps/desktop/package/addon-policy.json'),
    join(config.output, 'addon-policy.json')
  )
  const copy = (from, to) =>
    cp(from, join(config.output, to), { recursive: true, dereference: true })
  // Preserve symlinks verbatim so the copied-tree check refuses them instead of following them.
  await cp(config.application, join(config.output, 'application'), {
    recursive: true,
    verbatimSymlinks: true
  })
  const copiedApplication = join(config.output, 'application')
  const copiedAppCheck = await verifyStagedApplication(
    copiedApplication,
    expectedProvenance
  )
  if (!sameDigests(initialAppDigests, copiedAppCheck.digests))
    throw new Error('Application provenance changed during staging')
  await copy(config.postgres, 'postgres')
  await mkdir(join(config.output, 'bin'))
  await copy(config.node, 'bin/node')
  await copy(config.runtimeGuard, 'bin/runtime-guard')
  await copy(config.electron, 'electron')
  await mkdir(join(config.output, 'auth'))
  await copy(join(config.auth, 'auth'), 'auth/auth')
  await copy(join(config.auth, 'migrations'), 'auth/migrations')
  await mkdir(join(config.output, 'postgrest'))
  await copy(config.postgrest, 'postgrest/postgrest')
  if (config.updateConfig && !isAbsolute(config.updateConfig))
    throw new Error('Absolute update configuration path required')
  const updateConfig = updateConfiguration(
    JSON.parse(
      await readFile(
        config.updateConfig ??
          join(source, 'apps/desktop/package/updates.json'),
        'utf8'
      )
    )
  )
  await writeFile(
    join(config.output, 'updates.json'),
    JSON.stringify(updateConfig, null, 2) + '\n',
    { mode: 0o600 }
  )
  await mkdir(join(config.output, 'notices'))
  for (const [from, name] of [
    [config.nodeLicense, 'node-LICENSE'],
    [config.authLicense, 'supabase-auth-LICENSE'],
    [config.postgrestLicense, 'postgrest-LICENSE'],
    [join(config.postgres, 'COPYRIGHT'), 'postgresql-COPYRIGHT'],
    [join(config.electron, 'LICENSE'), 'electron-LICENSE'],
    [join(config.electron, 'LICENSES.chromium.html'), 'LICENSES.chromium.html']
  ]) {
    const notice = await readFile(from)
    if (!notice.length)
      throw new Error('A bundled component notice is missing or empty')
    await writeFile(join(config.output, 'notices', name), notice, {
      mode: 0o600
    })
  }
  for (const path of [
    'apps/desktop/launcher',
    'apps/desktop/local-schema',
    'apps/desktop/runtime-inputs.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  ])
    await copy(join(source, path), path)
  await mkdir(join(config.output, 'apps/desktop/proof'))
  for (const file of [
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
  ])
    await copy(
      join(source, 'apps/desktop/proof', file),
      join('apps/desktop/proof', file)
    )
  await writeFile(
    join(config.output, 'launch'),
    `#!/bin/sh\npackage_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$package_dir/bin/node" "$package_dir/apps/desktop/launcher/launch.mjs" "$@"\n`,
    { mode: 0o755 }
  )
  await writeFile(
    join(config.output, 'sbom.cdx.json'),
    JSON.stringify(
      generateSbom(
        JSON.parse(
          await readFile(
            join(source, 'apps/desktop/runtime-inputs.json'),
            'utf8'
          )
        ),
        JSON.parse(lockRaw.toString('utf8')),
        {
          application: {
            name: 'tacticus-analytics-preview',
            version: JSON.parse(
              await readFile(
                join(source, 'apps/desktop/package/updates.json'),
                'utf8'
              )
            ).version
          },
          provenance: {
            sourceCommit: buildRecord.sourceCommit,
            packageLockSha256: buildRecord.packageLockSha256
          }
        }
      ),
      null,
      2
    ) + '\n'
  )
  const inventory = []
  async function visit(path = '') {
    for (const entry of await readdir(join(config.output, path), {
      withFileTypes: true
    })) {
      const name = join(path, entry.name)
      if (entry.isDirectory()) await visit(name)
      else if (entry.isFile()) {
        if (
          /(^|\/)\.env(?:\.|$)|credentials\.json|workspace-owner\.json|pgdata\//.test(
            name
          )
        )
          throw new Error('Mutable state or environment file found in package')
        const bytes = await readFile(join(config.output, name))
        inventory.push({
          path: name,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        })
      } else throw new Error('Non-file package entry is unsupported')
    }
  }
  await visit()
  const privateMaterial = scanInventory(inventory)
  if (privateMaterial.length)
    throw new Error(
      `Private material in package: ${privateMaterial.join('; ')}`
    )
  await requireCleanBuildEnvironment(source)
  const afterStage = await captureCleanCheckoutProvenance(source, {
    allowBuildOutputs: true
  })
  if (
    afterStage.sourceCommit !== sourceCommit ||
    afterStage.packageLockSha256 !== sourceLockSha256
  )
    throw new Error('Packaging checkout provenance changed during staging')
  const verifiedCopiedApp = await verifyStagedApplication(
    copiedApplication,
    expectedProvenance
  )
  if (!sameDigests(initialAppDigests, verifiedCopiedApp.digests))
    throw new Error('Application provenance changed during staging')
  const inventoryHashes = new Map(
    inventory.map((entry) => [entry.path.replaceAll('\\', '/'), entry.sha256])
  )
  const inventoryApplicationPaths = [...inventoryHashes.keys()].filter((path) =>
    path.startsWith('application/')
  )
  if (inventoryApplicationPaths.length !== verifiedCopiedApp.digests.size)
    throw new Error(
      'Copied application provenance disagrees with package inventory'
    )
  for (const [rel, expectedSha] of verifiedCopiedApp.digests.entries()) {
    if (inventoryHashes.get(`application/${rel}`) !== expectedSha)
      throw new Error(
        'Copied application provenance disagrees with package inventory'
      )
  }
  await writeFile(
    join(config.output, 'package-inventory.json'),
    JSON.stringify(
      {
        platform: 'linux-x64',
        kind: 'private-synthetic-preview',
        sourceCommit: buildRecord.sourceCommit,
        packageLockSha256: buildRecord.packageLockSha256,
        files: inventory,
        totalBytes: inventory.reduce((total, file) => total + file.bytes, 0)
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({
      files: inventory.length,
      bytes: inventory.reduce((total, file) => total + file.bytes, 0)
    })
  )
} catch (error) {
  // Only remove an output directory this invocation created.
  if (createdOutputDir)
    await rm(config.output, { recursive: true, force: true })
  throw error
}
