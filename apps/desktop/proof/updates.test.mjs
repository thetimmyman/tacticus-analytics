import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import {
  mkdtemp,
  rm,
  readFile,
  readdir,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  updateConfiguration,
  verifiedUpdate,
  checkForUpdate,
  downloadUpdate
} from '../launcher/updates.mjs'
function fixture() {
  const keys = generateKeyPairSync('ed25519'),
    bytes = Buffer.from('synthetic packaged update')
  const config = {
    format: 'ta-update-configuration-v1',
    version: '0.0.0-preview2',
    sequence: 2,
    channel: 'private-preview',
    platform: 'linux-x64',
    packageName: 'tacticus-analytics-preview',
    packageFormat: 'arch',
    manifestURL: 'https://updates.example.invalid/manifest.json',
    publicKey: keys.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64')
  }
  const manifest = {
    format: 'ta-update-v1',
    channel: config.channel,
    platform: config.platform,
    packageName: config.packageName,
    packageFormat: 'arch',
    sequence: 3,
    version: '0.0.0-preview3',
    url: 'https://updates.example.invalid/packages/preview3.pkg.tar.zst',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    expiresAt: Date.now() + 86400000,
    notes: 'Synthetic updater acceptance fixture'
  }
  const envelope = (value = manifest) => {
    const payload = Buffer.from(JSON.stringify(value))
    return {
      payload: payload.toString('base64'),
      signature: sign(null, payload, keys.privateKey).toString('base64')
    }
  }
  return { bytes, config, manifest, envelope }
}
test('signed channel/platform manifest accepts only a newer immutable package', () => {
  const f = fixture(),
    update = verifiedUpdate(f.envelope(), f.config)
  assert.equal(update.sequence, 3)
  assert(Object.isFrozen(update))
  assert.equal(
    verifiedUpdate(f.envelope({ ...f.manifest, sequence: 2 }), f.config),
    null
  )
  for (const value of [
    { ...f.manifest, channel: 'stable' },
    { ...f.manifest, platform: 'foreign' },
    { ...f.manifest, url: 'https://foreign.invalid/packages/x.pkg.tar.zst' },
    { ...f.manifest, expiresAt: 1 },
    { ...f.manifest, extra: 'unknown' }
  ])
    assert.throws(() => verifiedUpdate(f.envelope(value), f.config))
  const changed = f.envelope()
  changed.payload = Buffer.from(
    JSON.stringify({ ...f.manifest, bytes: 1 })
  ).toString('base64')
  assert.throws(() => verifiedUpdate(changed, f.config))
})
test('unconfigured feeds produce no network access and plaintext public feeds refuse', async () => {
  const f = fixture()
  let calls = 0
  assert.deepEqual(
    await checkForUpdate(
      { ...f.config, manifestURL: null, publicKey: null },
      {
        fetch: async () => {
          calls++
        }
      }
    ),
    { configured: false, update: null }
  )
  assert.equal(calls, 0)
  assert.throws(() =>
    updateConfiguration({
      ...f.config,
      manifestURL: 'http://updates.example.invalid/manifest.json'
    })
  )
  assert.throws(() =>
    updateConfiguration({
      ...f.config,
      privateLoopbackPreview: true,
      manifestURL: 'http://foreign.invalid/manifest.json'
    })
  )
})
test('manual check verifies the response and never sends cookies or credentials', async () => {
  const f = fixture()
  const result = await checkForUpdate(f.config, {
    fetch: async (url, options) => {
      assert.equal(url, f.config.manifestURL)
      assert.equal(options.credentials, 'omit')
      assert.equal(options.redirect, 'error')
      assert.deepEqual(options.headers, { accept: 'application/json' })
      return new Response(JSON.stringify(f.envelope()), {
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  assert.equal(result.update.sequence, 3)
})
test('download publishes exact signed bytes, refuses forged calls, preserves existing files and removes failed partials', async () => {
  const f = fixture(),
    folder = await mkdtemp(join(tmpdir(), 'desktop-update-'))
  try {
    const update = verifiedUpdate(f.envelope(), f.config),
      path = join(folder, 'preview3.pkg.tar.zst')
    await assert.rejects(
      downloadUpdate(f.config, { ...update }, path, {
        fetch: async () => new Response(f.bytes)
      })
    )
    await downloadUpdate(f.config, update, path, {
      fetch: async (_url, options) => {
        assert.equal(options.credentials, 'omit')
        return new Response(f.bytes)
      }
    })
    assert.deepEqual(await readFile(path), f.bytes)
    await assert.rejects(
      downloadUpdate(f.config, update, path, {
        fetch: async () => new Response(f.bytes)
      })
    )
    assert.deepEqual(await readFile(path), f.bytes)
    const bad = join(folder, 'bad.pkg.tar.zst')
    await assert.rejects(
      downloadUpdate(f.config, update, bad, {
        fetch: async () => new Response(Buffer.from('corrupt'))
      })
    )
    assert.deepEqual(await readdir(folder), ['preview3.pkg.tar.zst'])
    const target = join(folder, 'owned.txt')
    await writeFile(target, 'private existing file')
    await symlink(target, join(folder, 'linked.pkg.tar.zst'))
    await assert.rejects(
      downloadUpdate(f.config, update, join(folder, 'linked.pkg.tar.zst'), {
        fetch: async () => new Response(f.bytes)
      })
    )
    assert.equal(await readFile(target, 'utf8'), 'private existing file')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('native update transport streams loopback bytes without redirects or session headers', async () => {
  const { createServer } = await import('node:http')
  const { nativeUpdateRequest } = await import('../launcher/updates.mjs')
  const seen = []
  const server = createServer((req, res) => {
    seen.push(req.headers)
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/payload' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(Buffer.alloc(1024 * 1024, 42))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    const response = await nativeUpdateRequest(origin + '/payload', {
      headers: { accept: 'application/octet-stream' },
      signal: AbortSignal.timeout(5000)
    })
    const reader = response.body.getReader()
    let bytes = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.length
    }
    reader.releaseLock()
    assert.equal(bytes, 1024 * 1024)
    const redirect = await nativeUpdateRequest(origin + '/redirect', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    })
    assert.equal(redirect.ok, false)
    await redirect.body.cancel()
    assert.equal(seen.length, 2)
    for (const headers of seen) {
      assert.equal(headers.cookie, undefined)
      assert.equal(headers.authorization, undefined)
      assert.equal(headers['x-desktop-transport'], undefined)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
