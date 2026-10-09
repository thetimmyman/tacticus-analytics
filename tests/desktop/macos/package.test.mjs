import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  writeFile,
  symlink,
  rm,
  cp,
  readlink,
  readFile
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  inventory,
  stage,
  containedLibrary
} from '../../../apps/desktop/platform/macos/stage.mjs'
import { privateState } from '../../../apps/desktop/platform/macos/state.mjs'
import { verifySchemaProofInstallation } from '../../../apps/desktop/platform/macos/schema-bootstrap-proof.mjs'

test('a copied staged package admits its inventoried empty directories and contained empty link target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mac directory inventory ü '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const inputs = join(root, 'inputs')
  const config = {
    output: join(root, 'candidate.app'),
    architecture: 'arm64',
    sourceCommit: 'a'.repeat(40)
  }
  for (const key of ['application', 'postgres', 'electron', 'auth']) {
    config[key] = join(inputs, key)
    await mkdir(config[key], { recursive: true })
  }
  // Inert inputs exercise the real packager and verifier, not native code.
  for (const key of ['node', 'postgrest', 'guard', 'vault']) {
    config[key] = join(inputs, key)
    await writeFile(config[key], 'synthetic executable')
  }
  await mkdir(join(config.postgres, 'bin'))
  for (const name of ['initdb', 'postgres', 'psql'])
    await writeFile(join(config.postgres, 'bin', name), 'synthetic postgres')
  await writeFile(join(config.auth, 'auth'), 'synthetic auth')
  await mkdir(join(config.application, 'empty-resources'))
  const versions = join(config.electron, 'Framework/Versions')
  await mkdir(join(versions, 'Empty'), { recursive: true })
  await symlink('Empty', join(versions, 'Current'))
  await stage(config)
  const installed = join(root, 'installed.app')
  await cp(config.output, installed, {
    recursive: true,
    verbatimSymlinks: true
  })
  await rm(inputs, { recursive: true })
  await rm(config.output, { recursive: true })
  const bytes = await readFile(
    join(installed, 'Contents/Resources/package-inventory.json')
  )
  const manifest = JSON.parse(bytes)
  const sourcePaths = [
    'apps/desktop/platform/macos/schema-bootstrap-proof.mjs',
    'apps/desktop/platform/macos/schema-bootstrap.mjs',
    'apps/desktop/platform/macos/services.mjs',
    'apps/desktop/platform/macos/workspace.mjs',
    'apps/desktop/proof/synthetic-import.mjs',
    'apps/desktop/local-schema/canonical-objects.sql',
    'apps/desktop/local-schema/authority.sql',
    'apps/desktop/local-schema/manifest.json'
  ]
  const sha = (value) => createHash('sha256').update(value).digest('hex')
  const result = await verifySchemaProofInstallation({
    installed,
    admission: {
      schemaVersion: 1,
      sourceCommit: config.sourceCommit,
      architecture: config.architecture,
      artifactSha256: 'b'.repeat(64),
      inventorySha256: sha(bytes),
      sourceHashes: Object.fromEntries(
        await Promise.all(
          sourcePaths.map(async (path) => [
            path,
            sha(await readFile(new URL('../../../' + path, import.meta.url)))
          ])
        )
      )
    }
  })
  assert.equal(result.files, manifest.files.length)
  assert.equal(manifest.schemaVersion, 2)
  assert.ok(
    manifest.directories.includes(
      'Contents/Resources/runtime/application/empty-resources'
    )
  )
  assert.ok(
    manifest.directories.includes(
      'Contents/Resources/runtime/electron/Framework/Versions/Empty'
    )
  )
  assert.equal(
    await readlink(
      join(
        installed,
        'Contents/Resources/runtime/electron/Framework/Versions/Current'
      )
    ),
    'Empty'
  )
})

test('relocated dependencies compare canonical roots and reject an escaping library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac library alias '))
  try {
    const runtime = join(root, 'runtime'),
      alias = join(root, 'alias')
    await mkdir(runtime)
    await writeFile(join(runtime, 'libpq.dylib'), 'synthetic')
    await symlink(runtime, alias)
    await containedLibrary(alias, join(runtime, 'libpq.dylib'))
    await containedLibrary(runtime, join(alias, 'libpq.dylib'))
    await writeFile(join(root, 'external.dylib'), 'synthetic')
    await symlink('../external.dylib', join(runtime, 'escape.dylib'))
    await assert.rejects(
      containedLibrary(alias, join(alias, 'escape.dylib')),
      /External relocated/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('package inventory rejects mutable state and escaping symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac package '))
  try {
    const pkg = join(root, 'package')
    await mkdir(pkg)
    await writeFile(join(pkg, 'asset.txt'), 'synthetic')
    const original = await inventory(pkg)
    assert.equal(original.length, 1)
    await writeFile(join(pkg, '.env'), 'SYNTHETIC-CANARY')
    await assert.rejects(inventory(pkg), /Mutable or private/)
    await rm(join(pkg, '.env'))
    await writeFile(join(root, 'outside'), 'synthetic')
    await symlink('../outside', join(pkg, 'external'))
    await assert.rejects(inventory(pkg), /External package symlink/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('package cannot stage a guessed platform or missing source identity', async () => {
  await assert.rejects(
    stage({
      output: '/synthetic',
      architecture: 'universal',
      sourceCommit: 'a'.repeat(40)
    }),
    /Explicit source/
  )
  await assert.rejects(
    stage({ output: '/synthetic', architecture: 'arm64', sourceCommit: '' }),
    /Explicit source/
  )
})

test('staging and installation retain contained framework links after source removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac framework ü '))
  try {
    const inputs = join(root, 'inputs')
    await mkdir(inputs)
    const config = {
      output: join(root, 'candidate.app'),
      architecture: 'arm64',
      sourceCommit: 'a'.repeat(40)
    }
    for (const key of ['application', 'postgres', 'electron', 'auth']) {
      config[key] = join(inputs, key)
      await mkdir(config[key])
    }
    for (const key of ['node', 'postgrest', 'guard', 'vault']) {
      config[key] = join(inputs, key)
      await writeFile(config[key], 'synthetic executable')
    }
    const versions = join(config.electron, 'Framework/Versions')
    await mkdir(join(versions, 'A'), { recursive: true })
    await writeFile(join(versions, 'A/binary'), 'synthetic framework')
    await symlink('A', join(versions, 'Current'))
    await stage(config)
    const installed = join(root, 'installed.app')
    await cp(config.output, installed, {
      recursive: true,
      verbatimSymlinks: true
    })
    await rm(inputs, { recursive: true })
    await rm(config.output, { recursive: true })
    assert.equal(
      await readlink(
        join(
          installed,
          'Contents/Resources/runtime/electron/Framework/Versions/Current'
        )
      ),
      'A'
    )
    assert.ok((await inventory(installed)).some((entry) => entry.link === 'A'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('private projected state survives a new reader; unsafe replacements refuse activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac state ü ')),
    path = join(root, 'personal.json')
  try {
    const state = privateState(path)
    state.write({
      version: 1,
      personal: { displayName: 'Example Player', roster: [] },
      vaultReferences: { Player: 'opaque-handle' }
    })
    assert.equal(
      privateState(path).read().personal.displayName,
      'Example Player'
    )
    await rm(path)
    await writeFile(join(root, 'unsafe'), '{}', { mode: 0o600 })
    await symlink('unsafe', path)
    assert.throws(() => privateState(path))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
