import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync
} from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inventory } from './schema-lifecycle.mjs'
import { validateBackup } from './workspace-transfer.mjs'
import {
  sealDirectory,
  unsealToDirectory
} from '../launcher/encrypted-backup.mjs'
import {
  encryptedTransfer,
  readPassphrase
} from '../launcher/encrypted-transfer.mjs'

const passphrase = Buffer.from('synthetic backup phrase only')
const schema = 'a'.repeat(64)
const marker = 'SYNTHETIC-PRIVATE-WORKSPACE-CANARY'
const worker = fileURLToPath(
  new URL('../launcher/encrypted-transfer.mjs', import.meta.url)
)

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'encrypted-backup-test-'))
  try {
    const source = join(root, 'checkpoint')
    await mkdir(source, { mode: 0o700 })
    await mkdir(join(source, 'pgdata'), { mode: 0o700 })
    await mkdir(join(source, 'pgdata/empty'), { mode: 0o700 })
    await writeFile(join(source, 'pgdata/PG_VERSION'), '18', { mode: 0o600 })
    await writeFile(
      join(source, 'pgdata/data'),
      `${marker}\n${'synthetic-page\n'.repeat(240000)}`,
      { mode: 0o600 }
    )
    await writeFile(
      join(source, 'credentials.json'),
      JSON.stringify({ fixture: marker }),
      { mode: 0o600 }
    )
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
async function missing(path) {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}
async function noPlaintextTemps(root) {
  assert.equal(
    (await readdir(root)).some(
      (name) =>
        name.startsWith('.encrypted-restore-') ||
        name.startsWith('.encrypted-transfer-')
    ),
    false
  )
}

test('encrypted stream roundtrip preserves complete checkpoint and empty directories with private modes', async () =>
  fixture(async (root, source, file) => {
    const original = await inventory(source)
    const sealed = await sealDirectory(source, file, passphrase)
    assert.equal(sealed.encrypted, true)
    assert.ok(sealed.bytes > 3 * 1024 * 1024)
    assert.equal((await lstat(file)).mode & 0o777, 0o600)
    const ciphertext = await readFile(file)
    assert.equal(ciphertext.includes(Buffer.from(marker)), false)
    assert.equal(ciphertext.includes(Buffer.from('credentials.json')), false)
    assert.equal(ciphertext.includes(passphrase), false)
    const output = join(root, 'restored')
    const receipt = await unsealToDirectory(file, output, passphrase)
    assert.equal(receipt.authenticated, true)
    assert.deepEqual(await inventory(output), original)
    assert.equal(
      (await lstat(join(output, 'pgdata/empty'))).mode & 0o777,
      0o700
    )
    assert.equal(
      (await lstat(join(output, 'credentials.json'))).mode & 0o777,
      0o600
    )
    await validateBackup(output)
    await noPlaintextTemps(root)
  }))

test('fresh salt and nonce produce different encrypted bytes for identical input', async () =>
  fixture(async (root, source, file) => {
    const second = join(root, 'second.tabackup')
    await sealDirectory(source, file, passphrase)
    await sealDirectory(source, second, passphrase)
    const a = await readFile(file),
      b = await readFile(second)
    assert.notDeepEqual(a.subarray(24, 52), b.subarray(24, 52))
    assert.notDeepEqual(a, b)
  }))

test('wrong passphrase, authenticated-header/ciphertext/tag tampering and truncation never create a target', async () =>
  fixture(async (root, source, file) => {
    await sealDirectory(source, file, passphrase)
    const bytes = await readFile(file)
    const destination = join(root, 'refused')
    await assert.rejects(
      unsealToDirectory(
        file,
        destination,
        Buffer.from('wrong synthetic backup phrase')
      )
    )
    await missing(destination)
    const payload = 64 + bytes.readUInt32BE(52)
    for (const position of [
      0,
      8,
      12,
      24,
      40,
      52,
      56,
      64,
      payload + 4,
      bytes.length - 1
    ]) {
      const tampered = Buffer.from(bytes)
      tampered[position] ^= 1
      await writeFile(file, tampered)
      await assert.rejects(unsealToDirectory(file, destination, passphrase))
      await missing(destination)
      await noPlaintextTemps(root)
    }
    for (const tampered of [
      bytes.subarray(0, 20),
      bytes.subarray(0, bytes.length - 1),
      Buffer.concat([bytes, Buffer.from('extra')])
    ]) {
      await writeFile(file, tampered)
      await assert.rejects(unsealToDirectory(file, destination, passphrase))
      await missing(destination)
    }
  }))

test('existing files, directories and symlink destinations are never replaced', async () =>
  fixture(async (root, source, file) => {
    await sealDirectory(source, file, passphrase)
    const existing = await readFile(file)
    await assert.rejects(
      sealDirectory(source, file, passphrase),
      /already exists/
    )
    assert.deepEqual(await readFile(file), existing)
    const destination = join(root, 'existing')
    await mkdir(destination, { mode: 0o700 })
    await assert.rejects(
      unsealToDirectory(file, destination, passphrase),
      /already exists/
    )
    assert.deepEqual(await readdir(destination), [])
    await rm(destination, { recursive: true })
    await writeFile(destination, marker)
    await assert.rejects(
      unsealToDirectory(file, destination, passphrase),
      /already exists/
    )
    assert.equal(await readFile(destination, 'utf8'), marker)
    await rm(destination)
    await symlink(source, destination)
    await assert.rejects(
      unsealToDirectory(file, destination, passphrase),
      /already exists/
    )
    await assert.rejects(
      sealDirectory(source, destination, passphrase),
      /already exists/
    )
  }))

test('linked inputs and linked ancestors are refused without following foreign data', async () =>
  fixture(async (root, source, file) => {
    const linked = join(root, 'linked')
    await symlink(source, linked)
    await assert.rejects(sealDirectory(linked, file, passphrase), /linked/i)
    const parentLink = join(root, 'parent-link')
    await symlink(root, parentLink)
    await assert.rejects(
      sealDirectory(join(parentLink, 'checkpoint'), file, passphrase),
      /linked/i
    )
    await symlink(
      join(source, 'credentials.json'),
      join(source, 'pgdata/linked')
    )
    await assert.rejects(sealDirectory(source, file, passphrase), /linked/i)
    await missing(file)
  }))

test('hardlinks, unsafe directory modes and invalid checkpoint manifests refuse export', async () =>
  fixture(async (root, source, file) => {
    await link(join(source, 'pgdata/data'), join(root, 'hardlink'))
    await assert.rejects(sealDirectory(source, file, passphrase))
    await rm(join(root, 'hardlink'))
    await chmod(source, 0o755)
    await assert.rejects(
      sealDirectory(source, file, passphrase),
      /safe permissions/
    )
    await chmod(source, 0o700)
    await writeFile(join(source, 'schema-version'), 'b'.repeat(64))
    await assert.rejects(sealDirectory(source, file, passphrase), /integrity/)
    await missing(file)
  }))

test('oversized sparse inputs are refused in preflight before hashing or deriving a key', async () =>
  fixture(async (root, source, file) => {
    const oversized = 33 * 1024 ** 3
    const data = await open(join(source, 'pgdata/data'), 'r+')
    try {
      await data.truncate(oversized)
    } finally {
      await data.close()
    }
    await assert.rejects(sealDirectory(source, file, passphrase))
    await missing(file)
    const header = Buffer.alloc(64)
    Buffer.from('TABKENC1').copy(header)
    header.writeUInt32BE(1, 8)
    header.writeUInt32BE(65536, 12)
    header.writeUInt32BE(8, 16)
    header.writeUInt32BE(1, 20)
    header.writeUInt32BE(1, 52)
    header.writeBigUInt64BE(BigInt(oversized), 56)
    const encrypted = await open(file, 'wx', 0o600)
    try {
      await encrypted.writeFile(header)
      await encrypted.truncate(64 + 1 + oversized + 16)
    } finally {
      await encrypted.close()
    }
    await assert.rejects(
      unsealToDirectory(file, join(root, 'refused'), passphrase)
    )
    await missing(join(root, 'refused'))
  }))

// Construct deliberately malicious authenticated files independently from the
// writer, so extraction admission is tested even when an attacker knows a key.
async function forged(file, entries, data = Buffer.alloc(0)) {
  const manifest = Buffer.from(
    JSON.stringify({ format: 'desktop-encrypted-backup-v1', entries })
  )
  const header = Buffer.alloc(64)
  Buffer.from('TABKENC1').copy(header)
  header.writeUInt32BE(1, 8)
  header.writeUInt32BE(65536, 12)
  header.writeUInt32BE(8, 16)
  header.writeUInt32BE(1, 20)
  randomBytes(16).copy(header, 24)
  randomBytes(12).copy(header, 40)
  header.writeUInt32BE(manifest.length, 52)
  header.writeBigUInt64BE(BigInt(data.length), 56)
  const key = scryptSync(passphrase, header.subarray(24, 40), 32, {
    N: 65536,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024
  })
  try {
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(40, 52))
    cipher.setAAD(header)
    await writeFile(
      file,
      Buffer.concat([
        header,
        cipher.update(manifest),
        cipher.update(data),
        cipher.final(),
        cipher.getAuthTag()
      ])
    )
  } finally {
    key.fill(0)
  }
}

test('authenticated malicious inventories cannot traverse, collide, invent parents or activate incomplete checkpoints', async () =>
  fixture(async (root, _source, file) => {
    const cases = [
      [{ kind: 'directory', path: '../outside' }],
      [{ kind: 'directory', path: '/outside' }],
      [{ kind: 'directory', path: 'a\\outside' }],
      [
        { kind: 'directory', path: 'a' },
        { kind: 'directory', path: 'a' }
      ],
      [{ kind: 'directory', path: 'absent/child' }],
      [{ kind: 'file', path: 'file', bytes: 0, sha256: 'invalid' }],
      [
        {
          kind: 'file',
          path: 'file',
          bytes: Number.MAX_SAFE_INTEGER + 1,
          sha256: 'a'.repeat(64)
        }
      ],
      [{ kind: 'directory', path: 'a/'.repeat(65) + 'b' }],
      []
    ]
    for (const entries of cases) {
      await forged(file, entries)
      await assert.rejects(
        unsealToDirectory(file, join(root, 'refused'), passphrase)
      )
      await missing(join(root, 'refused'))
      await noPlaintextTemps(root)
    }
    await missing(join(root, 'outside'))
  }))

test('passphrase pipe is bounded, preserves exact bytes and refuses terminal/short input', async () => {
  const value = Buffer.from('synthetic passphrase\n')
  const actual = await readPassphrase(
    Readable.from([value.subarray(0, 4), value.subarray(4)])
  )
  assert.deepEqual(actual, value)
  actual.fill(0)
  await assert.rejects(
    readPassphrase(Readable.from([Buffer.alloc(1025)])),
    /bound/
  )
  await assert.rejects(
    readPassphrase(Readable.from([Buffer.from('short')])),
    /incomplete/
  )
  const terminal = Readable.from([])
  terminal.isTTY = true
  await assert.rejects(readPassphrase(terminal), /private/)
})

async function childTransfer(operation, state, file, password = passphrase) {
  const lease = await open(join(state, 'runtime.lease'), 'a+', 0o600)
  try {
    const child = spawn(process.execPath, [worker, operation, state, file], {
      stdio: ['pipe', 'pipe', 'pipe', 'ignore', lease.fd],
      env: { PATH: process.env.PATH, DESKTOP_KERNEL_LEASE: '4' }
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (bytes) => {
      stdout += bytes
    })
    child.stderr.on('data', (bytes) => {
      stderr += bytes
    })
    child.stdin.end(password)
    const code = await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('exit', accept)
    })
    assert.equal(stdout.includes(password.toString()), false)
    assert.equal(stderr.includes(password.toString()), false)
    assert.equal(stdout.includes(marker), false)
    assert.equal(stderr.includes(marker), false)
    return { code, stdout, stderr }
  } finally {
    await lease.close()
  }
}

test('real worker accepts stdin secret with inherited lease descriptor, cleans private staging and preserves legacy restore', async () =>
  fixture(async (root, source, file) => {
    await rm(join(source, 'checkpoint.json'))
    const backup = await childTransfer('backup', source, file)
    assert.equal(backup.code, 0, backup.stderr)
    assert.equal(JSON.parse(backup.stdout).encrypted, true)
    const restored = join(root, 'workspace')
    await mkdir(restored, { mode: 0o700 })
    const result = await childTransfer('restore', restored, file)
    assert.equal(result.code, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).authenticated, true)
    assert.equal(
      await readFile(join(restored, 'credentials.json'), 'utf8'),
      JSON.stringify({ fixture: marker })
    )
    assert.equal(
      await readFile(join(restored, 'schema-version'), 'utf8'),
      schema
    )
    await noPlaintextTemps(root)
  }))

test('worker wrong-secret, occupied workspace and missing lease never overwrite user data', async () =>
  fixture(async (root, source, file) => {
    await sealDirectory(source, file, passphrase)
    const target = join(root, 'workspace')
    await mkdir(target, { mode: 0o700 })
    const wrong = await childTransfer(
      'restore',
      target,
      file,
      Buffer.from('wrong synthetic secret')
    )
    assert.equal(wrong.code, 1)
    assert.deepEqual(await readdir(target), ['runtime.lease'])
    await writeFile(join(target, 'existing'), marker)
    const occupied = await childTransfer('restore', target, file)
    assert.equal(occupied.code, 1)
    assert.equal(await readFile(join(target, 'existing'), 'utf8'), marker)
    await assert.rejects(
      encryptedTransfer('restore', target, file, passphrase),
      /lease/
    )
    await noPlaintextTemps(root)
  }))

test('SIGKILL leaves recognizable ciphertext only externally and next leased transfer reaps only its own private plaintext', async () =>
  fixture(async (root, source, file) => {
    await rm(join(source, 'checkpoint.json'))
    await writeFile(
      join(source, 'pgdata/data'),
      Buffer.alloc(64 * 1024 * 1024, 0x58),
      { mode: 0o600 }
    )
    const other = join(root, 'other-workspace')
    await mkdir(other, { mode: 0o700 })
    const otherInfo = await lstat(other)
    const otherId = createHash('sha256')
      .update(
        JSON.stringify({ path: other, dev: otherInfo.dev, ino: otherInfo.ino })
      )
      .digest('hex')
      .slice(0, 24)
    const unrelated = join(
      root,
      `.encrypted-transfer-${otherId}-${randomUUID()}`
    )
    await mkdir(unrelated, { mode: 0o700 })
    await writeFile(
      join(unrelated, 'transfer.json'),
      JSON.stringify({
        format: 'desktop-encrypted-transfer-staging-v1',
        state: otherId
      }),
      { mode: 0o600 }
    )
    await writeFile(join(unrelated, 'preserve'), marker, { mode: 0o600 })
    const lease = await open(join(source, 'runtime.lease'), 'a+', 0o600)
    const child = spawn(process.execPath, [worker, 'backup', source, file], {
      stdio: ['pipe', 'ignore', 'ignore', 'ignore', lease.fd],
      env: { PATH: process.env.PATH, DESKTOP_KERNEL_LEASE: '4' }
    })
    const exited = new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => accept({ code, signal }))
    })
    child.stdin.end(passphrase)
    let pending
    try {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        pending = (await readdir(root)).find(
          (name) =>
            name.startsWith('.export.tabackup.') && name.endsWith('.pending')
        )
        if (pending) break
        await new Promise((accept) => setTimeout(accept, 1))
      }
      assert.ok(pending, 'worker reached streamed encrypted output')
      child.kill('SIGKILL')
      assert.equal((await exited).signal, 'SIGKILL')
      await missing(file)
      const partial = await readFile(join(root, pending))
      if (partial.length >= 8)
        assert.equal(partial.subarray(0, 8).toString(), 'TABKENC1')
      assert.equal(partial.includes(Buffer.from(marker)), false)
      const stale = (await readdir(root)).filter(
        (name) =>
          name.startsWith('.encrypted-transfer-') &&
          join(root, name) !== unrelated
      )
      assert.equal(stale.length, 1)
      assert.equal((await lstat(join(root, stale[0]))).mode & 0o777, 0o700)
      assert.ok((await readdir(join(root, stale[0]))).includes('checkpoint'))
      const retry = await childTransfer(
        'backup',
        source,
        join(root, 'retry.tabackup')
      )
      assert.equal(retry.code, 0, retry.stderr)
      await missing(join(root, stale[0]))
      assert.equal(await readFile(join(unrelated, 'preserve'), 'utf8'), marker)
      assert.deepEqual(
        (await readdir(root)).filter((name) =>
          name.startsWith('.encrypted-transfer-')
        ),
        [unrelated.split('/').at(-1)]
      )
    } finally {
      child.kill('SIGKILL')
      await exited
      await lease.close()
    }
  }))
