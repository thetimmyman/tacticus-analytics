import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Mach-O magic bytes: 64/32-bit little/big-endian plus fat binaries.
const MACH_O_MAGIC = new Set(['cffaedfe', 'cefaedfe', 'cafebabe', 'bebafeca'])
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/u
const BUNDLE_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/u

export function validateTeamId(value) {
  if (typeof value !== 'string' || !TEAM_ID_PATTERN.test(value))
    throw new Error(
      'Team ID must be exactly ten uppercase alphanumeric characters'
    )
  return value
}

export function validateBundleId(value) {
  if (typeof value !== 'string' || !BUNDLE_ID_PATTERN.test(value))
    throw new Error('Bundle ID must be a reverse-DNS identifier')
  return value
}

function plist(entries) {
  const body = entries
    .map(([key, value]) => `\t<key>${key}</key>\n\t${value}`)
    .join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    `<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`
  )
}

// kind 'keychain' claims the restricted keychain access group and belongs only
// to the helper bundle that carries the provisioning profile. Hardened-runtime
// exceptions stay minimal: Electron needs JIT and unsigned executable memory,
// the bundled Node runtime needs JIT only.
export function entitlements({ teamId, bundleId, kind = 'keychain' }) {
  const team = validateTeamId(teamId)
  const bundle = validateBundleId(bundleId)
  if (!['keychain', 'electron', 'jit'].includes(kind))
    throw new Error('Unknown entitlement kind')
  const entries = []
  if (kind === 'keychain')
    entries.push([
      'keychain-access-groups',
      `<array>\n\t\t<string>${team}.${bundle}</string>\n\t</array>`
    ])
  if (kind === 'electron' || kind === 'jit')
    entries.push(['com.apple.security.cs.allow-jit', '<true/>'])
  if (kind === 'electron')
    entries.push([
      'com.apple.security.cs.allow-unsigned-executable-memory',
      '<true/>'
    ])
  return plist(entries)
}

export function defaultRunner(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options
  })
  if (result.error)
    return {
      status: 1,
      stdout: '',
      stderr: result.error.message ?? String(result.error)
    }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

const BUNDLE_SUFFIXES = ['.app', '.framework', '.xpc']
const VAULT_HELPER = 'Contents/Resources/runtime/helpers/SecretVault.app'

// Every nested Mach-O file and nested code bundle (.app, .framework, .xpc)
// ordered inside-out: deepest first, so a bundle is sealed after the code it
// contains, then the app bundle itself last.
export async function listSigningTargets(appBundle) {
  if (!isAbsolute(appBundle))
    throw new Error('Absolute app bundle path required')
  const found = []
  async function walk(directory, depth) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(directory, entry.name)
      const entryDepth = depth + 1
      if (entry.isDirectory()) {
        await walk(full, entryDepth)
        if (BUNDLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)))
          found.push({ path: full, depth: entryDepth })
      } else if (entry.isFile()) {
        const handle = await open(
          full,
          constants.O_RDONLY | constants.O_NOFOLLOW
        )
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size < 4) continue
          const header = Buffer.alloc(4)
          const { bytesRead } = await handle.read(header, 0, 4, 0)
          if (bytesRead === 4 && MACH_O_MAGIC.has(header.toString('hex')))
            found.push({ path: full, depth: entryDepth })
        } finally {
          await handle.close()
        }
      }
    }
  }
  await walk(appBundle, 0)
  found.sort((a, b) => b.depth - a.depth || a.path.localeCompare(b.path))
  return [...found.map((entry) => entry.path), appBundle]
}

function entitlementKind(target, appBundle) {
  if (target === appBundle) return null
  const relativePath = relative(appBundle, target).split(sep).join('/')
  if (
    relativePath === VAULT_HELPER ||
    relativePath.startsWith(VAULT_HELPER + '/')
  )
    return 'keychain'
  if (relativePath === 'Contents/Resources/runtime/bin/node') return 'jit'
  if (relativePath.startsWith('Contents/Resources/runtime/electron/'))
    return 'electron'
  return null
}

function helperInfoPlist(bundleId) {
  return plist([
    ['CFBundleDevelopmentRegion', '<string>en</string>'],
    ['CFBundleExecutable', '<string>secret-vault</string>'],
    ['CFBundleIdentifier', `<string>${bundleId}</string>`],
    ['CFBundleName', '<string>SecretVault</string>'],
    ['CFBundlePackageType', '<string>APPL</string>'],
    ['CFBundleVersion', '<string>1</string>'],
    ['LSUIElement', '<true/>']
  ])
}

// A standalone Mach-O cannot claim a restricted keychain entitlement because
// the entitlement must be backed by a provisioning profile found in an app
// bundle. Move the vault helper into its own minimal app bundle (with the
// profile) and leave a relative link at the original runtime path.
async function wrapVaultHelper(appBundle, bundleId, profileBytes) {
  const runtime = join(appBundle, 'Contents/Resources/runtime')
  const original = join(runtime, 'bin/secret-vault')
  let handle
  try {
    handle = await open(original, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return false
  }
  await handle.close()
  const helper = join(appBundle, VAULT_HELPER)
  const executable = join(helper, 'Contents/MacOS/secret-vault')
  await mkdir(join(helper, 'Contents/MacOS'), { recursive: true })
  await rename(original, executable)
  await chmod(executable, 0o755)
  await writeFile(
    join(helper, 'Contents/Info.plist'),
    helperInfoPlist(bundleId)
  )
  await writeFile(
    join(helper, 'Contents/embedded.provisionprofile'),
    profileBytes,
    {
      mode: 0o644
    }
  )
  await symlink(
    '../helpers/SecretVault.app/Contents/MacOS/secret-vault',
    original
  )
  return true
}

const INVENTORY_PATH = 'Contents/Resources/package-inventory.json'

// Signing rewrites Mach-O bytes and adds signature and helper files, so the
// staged inventory no longer describes the package. Regenerate it from the
// signed tree before the bundle is sealed; the seal directory itself is created
// afterwards and is checked by codesign, not by the inventory.
async function stagedInventory(directory) {
  // Loaded on demand: the staging module pulls in the full build toolchain.
  return (await import('./stage.mjs')).packageInventory(directory)
}

async function regenerateInventory(appBundle, inventory) {
  const path = join(appBundle, INVENTORY_PATH)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
  const { files, directories } = await inventory(appBundle)
  manifest.kind = 'signed-developer-id-candidate'
  manifest.files = files.filter((file) => file.path !== INVENTORY_PATH)
  manifest.directories = directories
  const text = JSON.stringify(manifest, null, 2)
  await writeFile(path, text)
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

export async function sign({
  appBundle,
  identity,
  teamId,
  bundleId,
  provisioningProfile,
  runner = defaultRunner,
  inventory = stagedInventory
}) {
  if (!isAbsolute(appBundle) || typeof identity !== 'string' || !identity)
    throw new Error('Absolute app bundle and signing identity required')
  if (!isAbsolute(provisioningProfile ?? ''))
    throw new Error('Absolute provisioning profile path required')
  const team = validateTeamId(teamId)
  const bundle = validateBundleId(bundleId)
  const profileBytes = await readFile(provisioningProfile)

  const vaultWrapped = await wrapVaultHelper(appBundle, bundle, profileBytes)
  const targets = await listSigningTargets(appBundle)
  const entitlementsDirectory = await mkdtemp(
    join(tmpdir(), 'ta entitlements ')
  )
  try {
    const files = {}
    for (const kind of ['keychain', 'electron', 'jit']) {
      files[kind] = join(entitlementsDirectory, `${kind}.entitlements`)
      await writeFile(
        files[kind],
        entitlements({ teamId: team, bundleId: bundle, kind }),
        { mode: 0o600 }
      )
    }

    const signTarget = async (target) => {
      const args = [
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--sign',
        identity
      ]
      const kind = entitlementKind(target, appBundle)
      if (kind) args.push('--entitlements', files[kind])
      args.push(target)
      const result = await runner('/usr/bin/codesign', args)
      if (result.status !== 0)
        throw new Error(`codesign rejected ${target}: ${result.stderr}`)
    }

    for (const target of targets.slice(0, -1)) await signTarget(target)

    await writeFile(
      join(appBundle, 'Contents/embedded.provisionprofile'),
      profileBytes,
      { mode: 0o644 }
    )
    const inventorySha256 = await regenerateInventory(appBundle, inventory)

    await signTarget(appBundle)

    return {
      signed: targets.length,
      provisioningProfileEmbedded: true,
      vaultHelperBundled: vaultWrapped,
      inventorySha256
    }
  } finally {
    await rm(entitlementsDirectory, { recursive: true, force: true })
  }
}

export async function verify({ appBundle, dmg, runner = defaultRunner }) {
  if (!isAbsolute(appBundle) || !isAbsolute(dmg))
    throw new Error('Absolute app bundle and DMG paths required')
  const gatekeeper = await runner('/usr/sbin/spctl', [
    '-a',
    '-vvv',
    '-t',
    'open',
    '--context',
    'context:primary-signature',
    dmg
  ])
  const signature = await runner('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    appBundle
  ])
  const stapler = await runner('/usr/bin/xcrun', ['stapler', 'validate', dmg])
  // Signature and notarization state are derived only from the verification
  // command results, never from the inputs supplied to this routine.
  const gatekeeperAccepted = gatekeeper.status === 0
  const signatureValid = signature.status === 0
  const stapleValidated = stapler.status === 0
  const artifactSha256 = createHash('sha256')
    .update(await readFile(dmg))
    .digest('hex')
  return {
    schemaVersion: 1,
    ok: gatekeeperAccepted && signatureValid && stapleValidated,
    signature: signatureValid ? 'developer-id' : 'unverified',
    notarization: stapleValidated
      ? 'stapled'
      : gatekeeperAccepted
        ? 'accepted'
        : 'unverified',
    gatekeeperAccepted,
    signatureValid,
    stapleValidated,
    artifactSha256
  }
}

// Returns the process exit code: verification evidence is printed either way,
// but any failed check yields a nonzero code so the pipeline cannot upload a
// rejected artifact.
export async function runCli(
  argv,
  { runner = defaultRunner, out = console.log } = {}
) {
  const [action, configPath] = argv
  if (!action || !configPath)
    throw new Error('Usage: sign-release.mjs <sign|verify> <config.json>')
  const config = JSON.parse(await readFile(resolve(configPath), 'utf8'))
  if (action === 'sign') {
    out(JSON.stringify(await sign({ ...config, runner }), null, 2))
    return 0
  }
  if (action === 'verify') {
    const evidence = await verify({ ...config, runner })
    out(JSON.stringify(evidence, null, 2))
    return evidence.ok ? 0 : 1
  }
  throw new Error('Unknown action')
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runCli(process.argv.slice(2))
