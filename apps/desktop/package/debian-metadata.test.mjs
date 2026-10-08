import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { debianMetadata } from './debian-metadata.mjs'

const source = JSON.parse(
  await readFile(new URL('./updates.json', import.meta.url), 'utf8')
)
const input = (configuration) => {
  const bytes = Buffer.from(JSON.stringify(configuration))
  return [
    bytes,
    {
      platform: 'linux-x64',
      kind: 'private-synthetic-preview',
      files: [
        {
          path: 'updates.json',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        },
        { path: 'application/server.js', bytes: 12, sha256: 'a'.repeat(64) }
      ],
      totalBytes: bytes.length + 12
    }
  ]
}

test('Debian version and disabled update format match the package with conserved inventory', () => {
  const [bytes, inventory] = input(source)
  const result = debianMetadata(bytes, inventory)
  assert.equal(result.version, source.version)
  assert.deepEqual(JSON.parse(result.updates), {
    ...source,
    packageFormat: 'deb'
  })
  assert.equal(JSON.parse(result.updates).manifestURL, null)
  assert.deepEqual(result.inventory.files[1], inventory.files[1])
  assert.equal(
    result.inventory.files[0].sha256,
    createHash('sha256').update(result.updates).digest('hex')
  )
  assert.equal(result.inventory.totalBytes, result.updates.length + 12)
  assert.equal(inventory.files[0].bytes, bytes.length)
})

test('a configured Arch feed cannot silently become a Debian feed', () => {
  const { publicKey } = generateKeyPairSync('ed25519')
  const configuration = {
    ...source,
    manifestURL: 'https://updates.example.invalid/manifest.json',
    publicKey: publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64')
  }
  assert.throws(() => debianMetadata(...input(configuration)))
  const result = debianMetadata(
    ...input({ ...configuration, packageFormat: 'deb' })
  )
  assert.equal(JSON.parse(result.updates).publicKey, configuration.publicKey)
})

test('invalid Debian versions and stale or duplicate inventory entries refuse', () => {
  for (const version of [
    'preview2',
    '1$(id)',
    '1/../../bad',
    '1;id',
    '1-',
    '1--',
    '1-a-',
    '1:a',
    '1:'
  ])
    assert.throws(() => debianMetadata(...input({ ...source, version })))
  for (const version of ['2.0-beta-1', '1.0.3', '1.0-rc1'])
    assert.equal(
      debianMetadata(...input({ ...source, version })).version,
      version
    )
  const [bytes, inventory] = input(source)
  assert.throws(() =>
    debianMetadata(Buffer.concat([bytes, Buffer.from(' ')]), inventory)
  )
  assert.throws(() =>
    debianMetadata(bytes, {
      ...inventory,
      files: [...inventory.files, inventory.files[0]]
    })
  )
})
