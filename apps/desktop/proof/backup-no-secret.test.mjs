import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { deflateSync, gzipSync } from 'node:zlib'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventory } from './schema-lifecycle.mjs'
import { validateBackup } from './workspace-transfer.mjs'
import {
  sealDirectory,
  unsealToDirectory
} from '../launcher/encrypted-backup.mjs'

const passphrase = Buffer.from('synthetic backup no-secret passphrase')
const schema = 'a'.repeat(64)

// Synthetic canaries only. None are real credentials, tokens, responses or
// identities; they exist solely to prove the encrypted backup never reveals
// workspace secrets in plaintext or in any recoverable encoded form.
const gameSecret =
  'SYNTHETIC-GAME-SECRET-CANARY-8f3a2b1c9d4e5f60718293a4b5c6d7e8'
const accessToken =
  'SYNTHETIC-ACCESS-TOKEN-CANARY-1a2b3c4d5e6f708192a3b4c5d6e7f809'
const rawApiBody = JSON.stringify({
  access_token: accessToken,
  token_type: 'bearer',
  expires_in: 3600,
  player: { id: 'synthetic-player', name: 'Synthetic Player', powerLevel: 42 }
})

const canaries = [
  ['game secret', gameSecret],
  ['access token', accessToken],
  ['raw API response body', rawApiBody]
]

// Base64 grouping depends on the byte offset, so the stable interior of the
// encoding is checked at all three alignments instead of a standalone encoding.
const base64Interiors = (value) =>
  [0, 1, 2].flatMap((offset) => {
    const encoded = Buffer.from('x'.repeat(offset) + value).toString('base64')
    return [Buffer.from(encoded.slice(4, -4))]
  })

// The complete contents of every source file that holds a canary, as written
// by the fixture, so compression and encoding of the whole payload is caught.
const credentialsFile = JSON.stringify({ gameSecret, accessToken })
const pageFile = `${rawApiBody}\n${'synthetic-page\n'.repeat(4096)}`
const payloads = [
  ['credentials file', Buffer.from(credentialsFile)],
  ['page file', Buffer.from(pageFile)]
]

// Every form a sloppy backup could write instead of real encryption: raw,
// base64, base64url, hex, percent-encoded, JSON-encoded, gzip and deflate.
const forbidden = [
  ...canaries.flatMap(([kind, value]) => {
    const raw = Buffer.from(value, 'utf8')
    return [
      ['utf8', raw],
      ...base64Interiors(value).map((bytes) => ['base64', bytes]),
      ['base64url', Buffer.from(raw.toString('base64url'))],
      ['hex', Buffer.from(raw.toString('hex'))],
      ['percent-encoded', Buffer.from(encodeURIComponent(value))],
      ['json-encoded', Buffer.from(JSON.stringify(value))]
    ].map(([form, bytes]) => ({ kind, form, bytes }))
  }),
  ...payloads.flatMap(([kind, raw]) =>
    [
      ['gzip', gzipSync(raw)],
      ['deflate', deflateSync(raw)],
      ['base64', Buffer.from(raw.toString('base64'))]
    ].map(([form, bytes]) => ({ kind, form, bytes }))
  )
]

function assertNoSecret(buffer, label) {
  for (const { kind, form, bytes } of forbidden) {
    assert.equal(
      buffer.includes(bytes),
      false,
      `${label} leaks the ${kind} canary in ${form} form`
    )
  }
}

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'backup-no-secret-'))
  try {
    const source = join(root, 'checkpoint')
    await mkdir(source, { mode: 0o700 })
    await mkdir(join(source, 'pgdata'), { mode: 0o700 })
    await mkdir(join(source, 'pgdata/empty'), { mode: 0o700 })
    await writeFile(join(source, 'pgdata/PG_VERSION'), '18', { mode: 0o600 })
    await writeFile(join(source, 'pgdata/data'), pageFile, { mode: 0o600 })
    await writeFile(join(source, 'credentials.json'), credentialsFile, {
      mode: 0o600
    })
    await writeFile(join(source, 'schema-version'), schema, { mode: 0o600 })
    await writeFile(
      join(source, 'checkpoint.json'),
      JSON.stringify({
        format: 'desktop-stopped-checkpoint-v1',
        source: schema,
        files: await inventory(source)
      }),
      { mode: 0o600 }
    )
    await validateBackup(source)
    return await action(root, source, join(root, 'export.tabackup'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('encrypted backup never reveals canary secrets in any region or encoded form', async () =>
  fixture(async (root, source, file) => {
    // Sanity: the canaries are genuinely present in the source checkpoint.
    const credentials = await readFile(join(source, 'credentials.json'), 'utf8')
    assert.equal(credentials.includes(gameSecret), true)
    assert.equal(credentials.includes(accessToken), true)
    const pages = await readFile(join(source, 'pgdata/data'), 'utf8')
    assert.equal(pages.includes(rawApiBody), true)

    const sealed = await sealDirectory(source, file, passphrase)
    assert.equal(sealed.encrypted, true)
    assert.equal(sealed.format, 'desktop-encrypted-backup-v2')

    const bytes = await readFile(file)
    assert.equal(bytes.subarray(0, 8).toString(), 'TABKENC2')

    const manifestLength = bytes.readUInt32BE(52)
    const total = Number(bytes.readBigUInt64BE(56))
    assert.equal(bytes.length, 64 + manifestLength + total + 16)
    const regions = [
      ['header', bytes.subarray(0, 64)],
      ['encrypted manifest', bytes.subarray(64, 64 + manifestLength)],
      [
        'encrypted file data',
        bytes.subarray(64 + manifestLength, 64 + manifestLength + total)
      ],
      ['authentication tag', bytes.subarray(bytes.length - 16)]
    ]
    for (const [label, region] of regions) assertNoSecret(region, label)
    assertNoSecret(bytes, 'complete backup artifact')
  }))

test('restored checkpoint recovers the canary secrets intact', async () =>
  fixture(async (root, source, file) => {
    await sealDirectory(source, file, passphrase)
    const restored = join(root, 'restored')
    const receipt = await unsealToDirectory(file, restored, passphrase)
    assert.equal(receipt.authenticated, true)
    assert.equal(
      (await readFile(join(restored, 'credentials.json'), 'utf8')).includes(
        gameSecret
      ),
      true
    )
    assert.equal(
      (await readFile(join(restored, 'pgdata/data'), 'utf8')).includes(
        rawApiBody
      ),
      true
    )
    await validateBackup(restored)
  }))
