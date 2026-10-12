import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { generateSbom } from './generate-sbom.mjs'

// Synthetic, non-sensitive fixtures for the deterministic CycloneDX generator.
function syntheticLockPackages() {
  return {
    '': { name: 'ta-preview', version: '0.1.0' },
    'node_modules/@scope/alpha-lib': {
      version: '2.0.0',
      integrity: `sha512-${Buffer.from([5, 6, 7, 8]).toString('base64')}`,
      license: 'Apache-2.0'
    },
    'node_modules/zebra-lib': {
      version: '1.0.0',
      integrity: `sha512-${Buffer.from([0, 1, 2, 3]).toString('base64')}`,
      license: 'MIT'
    },
    'node_modules/dev-tool': {
      version: '3.0.0',
      integrity: `sha1-${Buffer.from([10, 20, 30]).toString('base64')}`,
      license: 'ISC',
      dev: true
    },
    'node_modules/link-pkg': { resolved: 'packages/foo', link: true }
  }
}

function syntheticRuntimeInputs() {
  return {
    inputs: [
      {
        name: 'ZetaRuntime',
        version: '1.0.0',
        sha256: 'a'.repeat(64),
        artifact: 'zeta.tar',
        verification: 'digest',
        source: 'https://example/zeta'
      },
      {
        name: 'AlphaRuntime',
        version: '1.0.0',
        sha256: 'b'.repeat(64),
        artifact: 'alpha.tar',
        verification: 'digest'
      },
      {
        name: 'MidRuntime',
        version: '1.0.0',
        sha256: 'c'.repeat(64),
        artifact: 'mid.tar',
        verification: 'digest'
      }
    ]
  }
}

test('generateSbom is deterministic and omits timestamps by default', () => {
  const a = generateSbom(syntheticRuntimeInputs(), syntheticLockPackages(), {
    application: { name: 'ta-preview', version: '0.1.0' }
  })
  const b = generateSbom(syntheticRuntimeInputs(), syntheticLockPackages(), {
    application: { name: 'ta-preview', version: '0.1.0' }
  })
  assert.deepEqual(a, b)
  assert.equal(a.serialNumber, b.serialNumber)
  assert.match(
    a.serialNumber,
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  )
  assert.equal(a.metadata.timestamp, undefined)
})

test('generateSbom sorts components stably by type then name', () => {
  const bom = generateSbom(syntheticRuntimeInputs(), syntheticLockPackages(), {
    application: { name: 'ta-preview', version: '0.1.0' }
  })
  // Runtime inputs are application-typed and precede library-typed npm deps;
  // each group is sorted by name regardless of insertion order.
  assert.deepEqual(
    bom.components.map((c) => c.name),
    [
      'AlphaRuntime',
      'MidRuntime',
      'ZetaRuntime',
      '@scope/alpha-lib',
      'zebra-lib'
    ]
  )
})

test('npm integrity maps to CycloneDX hashes and dev deps are excluded', () => {
  const lockPackages = syntheticLockPackages()
  const bom = generateSbom({ inputs: [] }, lockPackages, {
    application: { name: 'ta-preview', version: '0.1.0' }
  })
  const names = bom.components.map((c) => c.name)
  // Dev dependency and workspace link are production-only excluded.
  assert.equal(names.includes('dev-tool'), false)
  assert.equal(names.includes('link-pkg'), false)

  const alpha = bom.components.find((c) => c.name === '@scope/alpha-lib')
  const expectedAlphaHex = Buffer.from([5, 6, 7, 8]).toString('hex')
  assert.deepEqual(alpha.hashes, [
    { alg: 'SHA-512', content: expectedAlphaHex }
  ])
  assert.equal(alpha.type, 'library')
  assert.equal(alpha.purl, 'pkg:npm/%40scope/alpha-lib@2.0.0')

  const zebra = bom.components.find((c) => c.name === 'zebra-lib')
  const expectedZebraHex = Buffer.from([0, 1, 2, 3]).toString('hex')
  assert.deepEqual(zebra.hashes, [
    { alg: 'SHA-512', content: expectedZebraHex }
  ])
  assert.equal(zebra.licenses[0].license.id, 'MIT')
})

test('runtime inputs map to SHA-256 hashes and a generic purl', () => {
  const bom = generateSbom(syntheticRuntimeInputs(), {
    '': { name: 'ta-preview', version: '0.1.0' }
  })
  const nodeLike = bom.components.find((c) => c.name === 'AlphaRuntime')
  assert.equal(nodeLike.type, 'application')
  assert.deepEqual(nodeLike.hashes, [
    { alg: 'SHA-256', content: 'b'.repeat(64) }
  ])
  assert.match(nodeLike.purl, /^pkg:generic\/alpharuntime@1\.0\.0$/)
  assert.equal(nodeLike['bom-ref'], 'runtime:AlphaRuntime:1.0.0')
})

test('rejects a runtime input missing a version', () => {
  const inputs = {
    inputs: [{ name: 'NoVersion', sha256: 'a'.repeat(64), artifact: 'x.tar' }]
  }
  assert.throws(
    () =>
      generateSbom(inputs, { '': { name: 'ta-preview', version: '0.1.0' } }),
    /missing version/
  )
})

test('rejects a runtime input missing a sha256 hash', () => {
  const inputs = {
    inputs: [{ name: 'NoHash', version: '1.0.0', artifact: 'x.tar' }]
  }
  assert.throws(
    () =>
      generateSbom(inputs, { '': { name: 'ta-preview', version: '0.1.0' } }),
    /missing sha256/
  )
})

test('deterministic CLI writes a stable CycloneDX BOM to --out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'generate-sbom-'))
  try {
    const inputsPath = join(root, 'runtime-inputs.json')
    const lockPath = join(root, 'package-lock.json')
    const outPath = join(root, 'bom.json')
    await writeFile(inputsPath, JSON.stringify(syntheticRuntimeInputs()))
    await writeFile(lockPath, JSON.stringify(syntheticLockPackages()))

    const scriptPath = join(
      dirname(fileURLToPath(import.meta.url)),
      'generate-sbom.mjs'
    )
    const first = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--out',
        outPath,
        '--runtime-inputs',
        inputsPath,
        '--package-lock',
        lockPath
      ],
      { encoding: 'utf8' }
    )
    assert.equal(first.status, 0, first.stderr)
    const bom = JSON.parse(await readFile(outPath, 'utf8'))
    assert.equal(bom.bomFormat, 'CycloneDX')
    assert.equal(bom.specVersion, '1.5')
    assert.ok(bom.serialNumber.startsWith('urn:uuid:'))
    assert.ok(bom.components.length > 0)
    assert.equal(bom.metadata.timestamp, undefined)

    // Re-run; the on-disk BOM must be byte-for-byte identical (no timestamps).
    const outPath2 = join(root, 'bom2.json')
    const second = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--out',
        outPath2,
        '--runtime-inputs',
        inputsPath,
        '--package-lock',
        lockPath
      ],
      { encoding: 'utf8' }
    )
    assert.equal(second.status, 0, second.stderr)
    assert.equal(
      await readFile(outPath, 'utf8'),
      await readFile(outPath2, 'utf8')
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('accepts a signed multi-artifact input without a single digest', () => {
  const bom = generateSbom(
    [
      {
        name: 'Database',
        version: '1.0',
        artifacts: ['a.pkg', 'b.pkg'],
        verification: 'Package signatures verified before extraction'
      }
    ],
    { packages: {} }
  )
  assert.equal(bom.components.length, 1)
  assert.equal(bom.components[0].hashes, undefined)
})

test('the committed runtime inputs generate without error', async () => {
  const { readFile } = await import('node:fs/promises')
  const inputs = JSON.parse(
    await readFile(new URL('../runtime-inputs.json', import.meta.url), 'utf8')
  )
  assert.ok(generateSbom(inputs, { packages: {} }).components.length >= 5)
})

test('drops optional packages for other platforms and keeps bom-refs unique', () => {
  const entry = (extra = {}) => ({
    version: '1.0.0',
    integrity: 'sha512-AAAA',
    ...extra
  })
  const bom = generateSbom([], {
    packages: {
      'node_modules/a': entry(),
      'node_modules/mac': entry({ os: ['darwin'], cpu: ['arm64'] }),
      'node_modules/lin': entry({ os: ['linux'], cpu: ['x64'] }),
      'node_modules/win': entry({ os: ['win32'] }),
      'node_modules/x/node_modules/dup': entry(),
      'node_modules/y/node_modules/dup': entry()
    }
  })
  const names = bom.components.map((c) => c.name).sort()
  assert.deepEqual(names, ['a', 'dup', 'dup', 'lin'])
  const refs = bom.components.map((c) => c['bom-ref'])
  assert.equal(new Set(refs).size, refs.length)
})

test('license expressions are not written as a single id', () => {
  const bom = generateSbom([], {
    packages: {
      'node_modules/a': {
        version: '1.0.0',
        integrity: 'sha512-AAAA',
        license: '(MIT OR CC0-1.0)'
      }
    }
  })
  assert.deepEqual(bom.components[0].licenses, [
    { expression: '(MIT OR CC0-1.0)' }
  ])
})
