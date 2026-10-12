// Deterministic CycloneDX 1.5 SBOM from the pinned runtime inputs and the
// production npm lockfile entries that fit the target platform. No network, no
// timestamps unless injected; the serial number is derived from the content.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const SPEC_VERSION = '1.5'
const BOM_VERSION = 1
const TOOL = { vendor: 'ta-sbom', name: 'generate-sbom.mjs', version: '1' }

const NPM_ALG_TO_CDX = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512'
}

// Content-derived UUID (version 8, custom): the first 16 bytes of a SHA-256.
function contentUuid(seed) {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [0, 8, 12, 16, 20]
    .map((start, i, all) => hex.slice(start, all[i + 1]))
    .join('-')
}

function parseIntegrity(integrity) {
  if (!integrity) return []
  return integrity
    .split(/\s+/)
    .filter(Boolean)
    .map((sri) => {
      const dash = sri.indexOf('-')
      const alg = sri.slice(0, dash)
      const b64 = sri.slice(dash + 1)
      const content = Buffer.from(b64, 'base64').toString('hex')
      return { alg: NPM_ALG_TO_CDX[alg] ?? alg.toUpperCase(), content }
    })
}

function packageNameFromKey(key) {
  const marker = 'node_modules/'
  const idx = key.lastIndexOf(marker)
  return key.slice(idx + marker.length)
}

function genericPurl(name, version) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'component'
  const encoded = encodeURIComponent(version)
  return version ? `pkg:generic/${slug}@${encoded}` : `pkg:generic/${slug}`
}

function npmPurl(name, version) {
  const [first, rest] = name.startsWith('@') ? name.split('/') : [name]
  const path = rest
    ? `${encodeURIComponent(first)}/${encodeURIComponent(rest)}`
    : encodeURIComponent(first)
  return `pkg:npm/${path}@${encodeURIComponent(version)}`
}

function fitsPlatform(pkg, platform) {
  const allows = (list, value) => {
    if (!Array.isArray(list) || !list.length) return true
    const negated = list.filter((entry) => entry.startsWith('!'))
    if (negated.some((entry) => entry.slice(1) === value)) return false
    const positive = list.filter((entry) => !entry.startsWith('!'))
    return !positive.length || positive.includes(value)
  }
  return allows(pkg.os, platform.os) && allows(pkg.cpu, platform.cpu)
}

function licenseEntry(license) {
  return /[\s()]/.test(license)
    ? { expression: license }
    : { license: { id: license } }
}

function buildRuntimeComponents(inputs) {
  return inputs.map((input) => {
    const { name, version, sha256, source, artifact, artifacts, verification } =
      input
    const missing = []
    if (!name) missing.push('name')
    if (!version) missing.push('version')
    // A multi-artifact input (a signed distro package set) carries no single
    // digest; it is accepted only with an explicit verification statement.
    const signedSet = !sha256 && artifacts?.length && verification
    if (!sha256 && !signedSet) missing.push('sha256')
    if (missing.length)
      throw new Error(
        `Runtime input missing ${missing.join('/')}: ${JSON.stringify(input)}`
      )
    const properties = []
    if (verification)
      properties.push({ name: 'verification', value: verification })
    if (source) properties.push({ name: 'source', value: source })
    if (artifact) properties.push({ name: 'artifact', value: artifact })
    if (artifacts)
      properties.push({ name: 'artifacts', value: artifacts.join(',') })
    return {
      type: 'application',
      'bom-ref': `runtime:${name}:${version}`,
      name,
      version,
      purl: genericPurl(name, version),
      ...(sha256 ? { hashes: [{ alg: 'SHA-256', content: sha256 }] } : {}),
      ...(properties.length ? { properties } : {})
    }
  })
}

function buildNpmComponents(lockPackages, platform) {
  const components = []
  for (const [key, pkg] of Object.entries(lockPackages)) {
    if (key === '' || !key.startsWith('node_modules/')) continue
    // Skip workspace links and any entry without a resolved, hashed release.
    if (pkg.link || !pkg.version || !pkg.integrity) continue
    // Production dependencies only.
    if (pkg.dev) continue
    if (!fitsPlatform(pkg, platform)) continue
    const name = pkg.name ?? packageNameFromKey(key)
    const hashes = parseIntegrity(pkg.integrity)
    if (!hashes.length) continue
    const component = {
      type: 'library',
      'bom-ref': `npm:${key}@${pkg.version}`,
      name,
      version: pkg.version,
      purl: npmPurl(name, pkg.version),
      hashes
    }
    if (pkg.license) component.licenses = [licenseEntry(pkg.license)]
    components.push(component)
  }
  return components
}

function compareComponents(a, b) {
  const byType = a.type.localeCompare(b.type)
  if (byType) return byType
  const byName = a.name.localeCompare(b.name)
  if (byName) return byName
  const byVersion = String(a.version ?? '').localeCompare(
    String(b.version ?? '')
  )
  if (byVersion) return byVersion
  return a['bom-ref'].localeCompare(b['bom-ref'])
}

export function generateSbom(runtimeInputs, lockPackages, options = {}) {
  const inputs = Array.isArray(runtimeInputs)
    ? runtimeInputs
    : (runtimeInputs?.inputs ?? [])
  const packages = lockPackages?.packages ?? lockPackages ?? {}

  const root = packages[''] ?? null
  const application =
    options.application ??
    (root && root.name ? { name: root.name, version: root.version } : null)

  const runtimeComponents = buildRuntimeComponents(inputs)
  const npmComponents = buildNpmComponents(
    packages,
    options.platform ?? { os: 'linux', cpu: 'x64' }
  )

  const components = [...runtimeComponents, ...npmComponents].sort(
    compareComponents
  )

  const serialSeed = createHash('sha256')
    .update(
      JSON.stringify({
        bomFormat: 'CycloneDX',
        specVersion: SPEC_VERSION,
        bomVersion: BOM_VERSION,
        components,
        application: application ?? null
      })
    )
    .digest('hex')
  const serialNumber = `urn:uuid:${contentUuid(serialSeed)}`

  const metadata = {
    tools: [TOOL],
    ...(application
      ? {
          component: {
            type: 'application',
            'bom-ref': 'app',
            name: application.name,
            version: application.version,
            purl: genericPurl(application.name, application.version)
          }
        }
      : {})
  }
  if (options.timestamp) metadata.timestamp = options.timestamp

  return {
    bomFormat: 'CycloneDX',
    specVersion: SPEC_VERSION,
    serialNumber,
    version: BOM_VERSION,
    metadata,
    components
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1]
        i++
      } else {
        args[key] = true
      }
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const out = args.out
  if (!out) {
    console.error(
      'Usage: generate-sbom.mjs --out <bom.json> [--runtime-inputs <path>] [--package-lock <path>] [--timestamp <iso>]'
    )
    process.exit(2)
  }
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const runtimeInputsPath =
    args['runtime-inputs'] ?? join(source, 'apps/desktop/runtime-inputs.json')
  const packageLockPath =
    args['package-lock'] ?? join(source, 'package-lock.json')
  const [runtimeInputs, lock] = await Promise.all([
    JSON.parse(await readFile(runtimeInputsPath, 'utf8')),
    JSON.parse(await readFile(packageLockPath, 'utf8'))
  ])
  const identity = JSON.parse(
    await readFile(join(source, 'apps/desktop/package/updates.json'), 'utf8')
  )
  const bom = generateSbom(runtimeInputs, lock, {
    application: { name: identity.packageName, version: identity.version },
    timestamp: args.timestamp ? String(args.timestamp) : undefined
  })
  await writeFile(resolve(out), JSON.stringify(bom, null, 2) + '\n', {
    mode: 0o600
  })
  console.log(
    JSON.stringify({
      bomFormat: bom.bomFormat,
      specVersion: bom.specVersion,
      components: bom.components.length
    })
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
