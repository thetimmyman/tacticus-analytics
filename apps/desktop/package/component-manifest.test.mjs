import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifest, diffManifest } from './component-manifest.mjs'

// Gate (d) self-test: exercises the manifest generator/verifier against
// synthetic stand-in files, needing no downloaded native binaries. See
// apps/desktop/docs/ARCHITECTURE-DECISION.md for the real-binary path.

async function withSyntheticArtifacts(run) {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-manifest-'))
  try {
    const nodeArtifact = join(dir, 'node-stand-in.tar')
    const electronArtifact = join(dir, 'electron-stand-in.zip')
    await writeFile(nodeArtifact, 'synthetic node archive contents')
    await writeFile(electronArtifact, 'synthetic electron archive contents')
    await run({ dir, nodeArtifact, electronArtifact })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('buildManifest hashes each component artifact and sorts by component name', async () => {
  await withSyntheticArtifacts(async ({ nodeArtifact, electronArtifact }) => {
    const manifest = await buildManifest([
      {
        name: 'Node.js',
        version: '22.23.2',
        license: 'MIT',
        artifact: nodeArtifact
      },
      {
        name: 'Electron',
        version: '44.5.1',
        license: 'MIT',
        artifact: electronArtifact
      }
    ])
    assert.equal(manifest.length, 2)
    assert.deepEqual(
      manifest.map((entry) => entry.component),
      ['Electron', 'Node.js']
    )
    for (const entry of manifest) assert.match(entry.sha256, /^[a-f0-9]{64}$/)
  })
})

test('buildManifest rejects a component descriptor missing a required field', async () => {
  await withSyntheticArtifacts(async ({ nodeArtifact }) => {
    await assert.rejects(
      buildManifest([
        { name: 'Node.js', version: '22.23.2', artifact: nodeArtifact }
      ]),
      /missing name\/version\/license\/artifact/
    )
  })
})

test('diffManifest reports no problems when actual matches expected', async () => {
  await withSyntheticArtifacts(async ({ nodeArtifact }) => {
    const manifest = await buildManifest([
      {
        name: 'Node.js',
        version: '22.23.2',
        license: 'MIT',
        artifact: nodeArtifact
      }
    ])
    assert.deepEqual(diffManifest(manifest, manifest), [])
  })
})

test('diffManifest flags a version drift, a license drift, and a hash drift', async () => {
  await withSyntheticArtifacts(async ({ nodeArtifact }) => {
    const actual = await buildManifest([
      {
        name: 'Node.js',
        version: '22.23.2',
        license: 'MIT',
        artifact: nodeArtifact
      }
    ])
    const expected = [
      {
        component: 'Node.js',
        version: '20.0.0',
        license: 'ISC',
        sha256: 'f'.repeat(64)
      }
    ]
    const problems = diffManifest(actual, expected)
    assert.equal(problems.length, 3)
    assert.ok(problems.some((p) => p.includes('version mismatch')))
    assert.ok(problems.some((p) => p.includes('license mismatch')))
    assert.ok(problems.some((p) => p.includes('sha256 mismatch')))
  })
})

test('diffManifest flags a missing component and an unexpected component', async () => {
  await withSyntheticArtifacts(async ({ nodeArtifact, electronArtifact }) => {
    const actual = await buildManifest([
      {
        name: 'Electron',
        version: '44.5.1',
        license: 'MIT',
        artifact: electronArtifact
      }
    ])
    const expected = await buildManifest([
      {
        name: 'Node.js',
        version: '22.23.2',
        license: 'MIT',
        artifact: nodeArtifact
      }
    ])
    const problems = diffManifest(actual, expected)
    assert.ok(
      problems.some((p) =>
        p.includes('Missing component in actual manifest: Node.js')
      )
    )
    assert.ok(
      problems.some((p) =>
        p.includes('Unexpected component in actual manifest: Electron')
      )
    )
  })
})
