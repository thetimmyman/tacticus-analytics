import { constants as fsConstants } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
  readdir
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  resolve,
  join,
  dirname,
  basename,
  isAbsolute,
  parse,
  sep
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
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

const sameIdentity = (info, identity) =>
  info.dev === identity.dev && info.ino === identity.ino
const ownUid = typeof process.getuid === 'function' ? process.getuid() : null

// Every component from the root to the directory must be a real directory that no other
// user can rename entries in: owned by this user or root, and not group- or
// other-writable unless sticky. Returns the directory's (dev, ino).
async function requireSafeDirectory(directory, label) {
  if (resolve(directory) !== directory)
    throw new Error(`Normalized absolute ${label} path required`)
  const { root } = parse(directory)
  const components = [root]
  for (const part of directory.slice(root.length).split(sep).filter(Boolean))
    components.push(join(components.at(-1), part))
  let info
  for (const current of components) {
    try {
      info = await lstat(current)
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error(`${label} directory must already exist`)
      throw error
    }
    if (info.isSymbolicLink())
      throw new Error(`${label} path must not traverse a symlink`)
    if (!info.isDirectory()) throw new Error(`${label} must be a directory`)
    if (
      ownUid !== null &&
      ((info.uid !== ownUid && info.uid !== 0) ||
        ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0))
    )
      throw new Error(
        `${label} directory must not be writable by other users unless sticky: ${current}`
      )
  }
  if ((await realpath(directory)) !== directory)
    throw new Error(`${label} path must not traverse a symlink`)
  return { dev: info.dev, ino: info.ino }
}

async function requireSafeOutputParent(output) {
  if (resolve(output) !== output)
    throw new Error('Normalized absolute output path required')
  const parent = dirname(output)
  if (parent === output) throw new Error('Output must not be a filesystem root')
  return requireSafeDirectory(parent, 'Package output parent')
}

// Directory descriptors are reached through /proc/self/fd/<fd>, which resolves to the
// opened inode, never by name. Every staging write and removal goes through one, so a
// rename or symlink swap of any path component cannot redirect it.
const OPEN_DIRECTORY =
  fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
const pinnedPath = (handle, rel = '') =>
  rel ? join(`/proc/self/fd/${handle.fd}`, rel) : `/proc/self/fd/${handle.fd}`

async function openPinnedDirectory(path, identity) {
  let handle
  try {
    handle = await open(path, OPEN_DIRECTORY)
  } catch (error) {
    if (['ELOOP', 'ENOTDIR', 'ENOENT'].includes(error.code))
      throw new Error(`directory changed identity (${error.code})`)
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isDirectory() || (identity && !sameIdentity(info, identity)))
      throw new Error('directory changed identity')
    // Fail closed where /proc does not resolve descriptors to their inode.
    if (!sameIdentity(await stat(pinnedPath(handle)), info))
      throw new Error('/proc/self/fd does not resolve directory descriptors')
    return { handle, info }
  } catch (error) {
    await handle.close()
    throw error
  }
}

// Empty a pinned directory. Each child directory is opened without following links and
// emptied through its own descriptor; only then is its now-empty name removed.
async function emptyPinnedDirectory(handle) {
  const base = pinnedPath(handle)
  for (const name of await readdir(base)) {
    const path = join(base, name)
    const info = await lstat(path)
    if (info.isDirectory()) {
      const child = await openPinnedDirectory(path, info)
      try {
        await emptyPinnedDirectory(child.handle)
      } finally {
        await child.handle.close()
      }
      await rmdir(path)
    } else await unlink(path)
  }
}

// Remove a directory this invocation created, inside a pinned parent. The entry is moved to
// a private name, opened without following links and checked against the recorded inode,
// then emptied through that descriptor. A swap after the check cannot redirect any
// removal; the final rmdir only removes an empty directory and refuses a replacement.
async function removePinnedEntry(parentHandle, name, identity) {
  const discard = `.${name}.discard-${randomBytes(8).toString('hex')}`
  await rename(
    pinnedPath(parentHandle, name),
    pinnedPath(parentHandle, discard)
  )
  const moved = await openPinnedDirectory(
    pinnedPath(parentHandle, discard),
    identity
  )
  try {
    await emptyPinnedDirectory(moved.handle)
  } finally {
    await moved.handle.close()
  }
  const entry = await lstat(pinnedPath(parentHandle, discard))
  if (entry.isSymbolicLink() || !sameIdentity(entry, identity))
    throw new Error('package output directory changed identity before removal')
  await rmdir(pinnedPath(parentHandle, discard))
}

// Atomic single-directory acquisition inside the pinned parent. EEXIST means another
// owner, so fail without touching it. The output descriptor stays open for the whole run.
async function acquireOutput(output) {
  const parent = dirname(output)
  const name = basename(output)
  const parentIdentity = await requireSafeOutputParent(output)
  const pinnedParent = await openPinnedDirectory(parent, parentIdentity)
  const parentHandle = pinnedParent.handle
  try {
    try {
      await mkdir(pinnedPath(parentHandle, name), { mode: 0o700 })
    } catch (error) {
      if (error.code === 'EEXIST')
        throw new Error('Package output already exists')
      throw error
    }
    // mkdir returns no inode, so prove the entry is still the fresh private directory we made.
    let pinnedOutput
    try {
      pinnedOutput = await openPinnedDirectory(pinnedPath(parentHandle, name))
      const created = pinnedOutput.info
      if (
        (ownUid !== null && created.uid !== ownUid) ||
        (created.mode & 0o077) !== 0 ||
        (await readdir(pinnedPath(pinnedOutput.handle))).length !== 0 ||
        !sameIdentity(await lstat(pinnedPath(parentHandle, name)), created)
      )
        throw new Error('changed identity')
    } catch (error) {
      await pinnedOutput?.handle.close()
      console.error(
        `Refusing to remove package output ${output}: package output directory changed identity during acquisition; left in place`
      )
      throw new Error(
        `Package output directory changed identity during acquisition: ${error.message}`
      )
    }
    return {
      output,
      name,
      parentIdentity,
      parentHandle,
      outputHandle: pinnedOutput.handle,
      outputIdentity: { dev: pinnedOutput.info.dev, ino: pinnedOutput.info.ino }
    }
  } catch (error) {
    await parentHandle.close()
    throw error
  }
}

// The absolute output path and the pinned parent must both still reach exactly the
// directory this invocation created. Checked between every staging phase.
async function assertOwnedOutput(owned) {
  try {
    const parentIdentity = await requireSafeOutputParent(owned.output)
    if (!sameIdentity(parentIdentity, owned.parentIdentity))
      throw new Error('parent directory changed identity')
    for (const path of [
      owned.output,
      pinnedPath(owned.parentHandle, owned.name)
    ]) {
      const entry = await lstat(path)
      if (
        entry.isSymbolicLink() ||
        !entry.isDirectory() ||
        !sameIdentity(entry, owned.outputIdentity)
      )
        throw new Error('output directory changed identity')
    }
  } catch (error) {
    throw new Error(
      `Package output directory changed identity during staging: ${error.message}`
    )
  }
}

async function closeOwnedOutput(owned) {
  await owned.outputHandle.close()
  await owned.parentHandle.close()
}

// Remove only the directory this invocation created, and only while both its path and its
// pinned parent still reach it. Any identity change refuses and leaves everything in place.
async function releaseOwnedOutput(owned) {
  try {
    await assertOwnedOutput(owned)
    await owned.outputHandle.close()
    await removePinnedEntry(
      owned.parentHandle,
      owned.name,
      owned.outputIdentity
    )
  } catch (reason) {
    console.error(
      `Refusing to remove package output ${owned.output}: ${reason.message}; left in place`
    )
  } finally {
    await owned.outputHandle.close().catch(() => {})
    await owned.parentHandle.close().catch(() => {})
  }
}

// Bundle add-ons in a private scratch directory under a safe temporary root, never through
// the output path. Once the bundler returns, ownership is re-checked before anything is
// copied, and the results enter the pinned output only after their digests are verified.
async function bundleNativeAddons(at, afterBuild) {
  const scratchRoot = tmpdir()
  const rootIdentity = await requireSafeDirectory(
    scratchRoot,
    'Temporary scratch'
  )
  const pinnedRoot = await openPinnedDirectory(scratchRoot, rootIdentity)
  try {
    const scratch = await mkdtemp(
      join(pinnedPath(pinnedRoot.handle), 'ta-desktop-addons-')
    )
    const scratchName = basename(scratch)
    const pinnedScratch = await openPinnedDirectory(scratch)
    const scratchIdentity = pinnedScratch.info
    try {
      if (
        (ownUid !== null && scratchIdentity.uid !== ownUid) ||
        (scratchIdentity.mode & 0o077) !== 0
      )
        throw new Error('Add-on scratch directory is not private')
      const built = await buildNativeAddons(join(scratchRoot, scratchName))
      await afterBuild()
      const scratchNow = await lstat(join(scratchRoot, scratchName))
      if (
        scratchNow.isSymbolicLink() ||
        !sameIdentity(scratchNow, scratchIdentity)
      )
        throw new Error('Add-on scratch directory changed identity')
      const addons = at('apps/desktop/addons')
      await mkdir(addons, { recursive: true, mode: 0o700 })
      const names = (await readdir(pinnedPath(pinnedScratch.handle))).sort()
      const expected = [
        'native-components.json',
        ...built.map((file) => file.path)
      ].sort()
      if (names.join('\0') !== expected.join('\0'))
        throw new Error('Native add-on bundle contains unexpected files')
      for (const name of names) {
        const bytes = await readFile(pinnedPath(pinnedScratch.handle, name))
        const declared = built.find((file) => file.path === name)
        if (
          declared &&
          createHash('sha256').update(bytes).digest('hex') !== declared.sha256
        )
          throw new Error(`Native add-on bundle changed after build: ${name}`)
        await writeFile(join(addons, name), bytes, { mode: 0o600, flag: 'wx' })
      }
    } finally {
      await pinnedScratch.handle.close()
      await removePinnedEntry(
        pinnedRoot.handle,
        scratchName,
        scratchIdentity
      ).catch((reason) => {
        console.error(
          `Refusing to remove add-on scratch directory ${join(scratchRoot, scratchName)}: ${reason.message}; left in place`
        )
      })
    }
  } finally {
    await pinnedRoot.handle.close()
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
await requireSafeOutputParent(config.output)
const { record: buildRecord, digests: initialAppDigests } =
  await verifyStagedApplication(config.application, expectedProvenance)
const ownedOutput = await acquireOutput(config.output)
// Every staging path is anchored in the pinned output descriptor.
const at = (rel) => pinnedPath(ownedOutput.outputHandle, rel)
try {
  await assertOwnedOutput(ownedOutput)
  await bundleNativeAddons(at, () => assertOwnedOutput(ownedOutput))
  await assertOwnedOutput(ownedOutput)
  if (config.addonPolicy && !isAbsolute(config.addonPolicy))
    throw new Error('Absolute add-on policy path required')
  await cp(
    config.addonPolicy ??
      join(source, 'apps/desktop/package/addon-policy.json'),
    at('addon-policy.json')
  )
  const copy = (from, to) =>
    cp(from, at(to), { recursive: true, dereference: true })
  // Preserve symlinks verbatim so the copied-tree check refuses them instead of following them.
  await cp(config.application, at('application'), {
    recursive: true,
    verbatimSymlinks: true
  })
  const copiedApplication = at('application')
  const copiedAppCheck = await verifyStagedApplication(
    copiedApplication,
    expectedProvenance
  )
  if (!sameDigests(initialAppDigests, copiedAppCheck.digests))
    throw new Error('Application provenance changed during staging')
  await assertOwnedOutput(ownedOutput)
  await copy(config.postgres, 'postgres')
  await mkdir(at('bin'))
  await copy(config.node, 'bin/node')
  await copy(config.runtimeGuard, 'bin/runtime-guard')
  await copy(config.electron, 'electron')
  await mkdir(at('auth'))
  await copy(join(config.auth, 'auth'), 'auth/auth')
  await copy(join(config.auth, 'migrations'), 'auth/migrations')
  await mkdir(at('postgrest'))
  await copy(config.postgrest, 'postgrest/postgrest')
  await assertOwnedOutput(ownedOutput)
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
    at('updates.json'),
    JSON.stringify(updateConfig, null, 2) + '\n',
    { mode: 0o600 }
  )
  await assertOwnedOutput(ownedOutput)
  await mkdir(at('notices'))
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
    await writeFile(at(join('notices', name)), notice, {
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
  await mkdir(at('apps/desktop/proof'))
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
    at('launch'),
    `#!/bin/sh\npackage_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$package_dir/bin/node" "$package_dir/apps/desktop/launcher/launch.mjs" "$@"\n`,
    { mode: 0o755 }
  )
  await writeFile(
    at('sbom.cdx.json'),
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
  await assertOwnedOutput(ownedOutput)
  const inventory = []
  async function visit(path = '') {
    for (const entry of await readdir(at(path), {
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
        const bytes = await readFile(at(name))
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
  await assertOwnedOutput(ownedOutput)
  await writeFile(
    at('package-inventory.json'),
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
  await assertOwnedOutput(ownedOutput)
  await closeOwnedOutput(ownedOutput)
  console.log(
    JSON.stringify({
      files: inventory.length,
      bytes: inventory.reduce((total, file) => total + file.bytes, 0)
    })
  )
} catch (error) {
  // Only remove the output directory this invocation created, and only if it is still that directory.
  await releaseOwnedOutput(ownedOutput)
  throw error
}
