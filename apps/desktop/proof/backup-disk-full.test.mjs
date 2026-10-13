import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventory } from './schema-lifecycle.mjs'
import { validateBackup } from './workspace-transfer.mjs'
import {
  sealDirectory,
  unsealToDirectory
} from '../launcher/encrypted-backup.mjs'

const passphrase = Buffer.from('synthetic backup disk-full passphrase')
const schema = 'b'.repeat(64)
const record = 'synthetic-committed-record\n'.repeat(4096)

// Fault injection without a privileged tmpfs: the backup streams every byte
// through FileHandle.write. Like a filling volume, the shim accepts bytes up to
// the budget (a short write when the budget ends inside a buffer) and then
// fails the next write with ENOSPC.
async function withDiskFull(budget, action) {
  const probe = await open(import.meta.filename, 'r')
  const proto = Object.getPrototypeOf(probe)
  await probe.close()
  const original = proto.write
  let remaining = budget
  proto.write = async function (buffer, offset, length, position) {
    if (remaining <= 0) {
      const error = new Error('ENOSPC: no space left on device, write')
      error.code = 'ENOSPC'
      error.errno = -28
      error.syscall = 'write'
      throw error
    }
    const accepted = Math.min(length, remaining)
    remaining -= accepted
    return original.call(this, buffer, offset, accepted, position)
  }
  try {
    return await action()
  } finally {
    proto.write = original
  }
}

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'backup-disk-full-'))
  try {
    const source = join(root, 'checkpoint')
    const target = join(root, 'volume')
    await mkdir(source, { mode: 0o700 })
    await mkdir(target, { mode: 0o700 })
    await mkdir(join(source, 'pgdata'), { mode: 0o700 })
    await mkdir(join(source, 'pgdata/empty'), { mode: 0o700 })
    await writeFile(join(source, 'pgdata/PG_VERSION'), '18', { mode: 0o600 })
    await writeFile(join(source, 'pgdata/data'), record, { mode: 0o600 })
    await writeFile(join(source, 'credentials.json'), '{"synthetic":true}', {
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
    return await action({
      root,
      source,
      target,
      file: join(target, 'export.tabackup')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('a full volume leaves no partial backup and preserves committed records', async () =>
  fixture(async ({ root, source, target, file }) => {
    const whole = await sealDirectory(source, file, passphrase)
    const wholeBytes = (await stat(file)).size
    assert.equal(whole.encrypted, true)
    await rm(file)

    // Fail at the first write, inside the header, mid-data and at the last byte.
    for (const budget of [
      0,
      40,
      70,
      Math.floor(wholeBytes / 2),
      wholeBytes - 1
    ]) {
      await assert.rejects(
        withDiskFull(budget, () => sealDirectory(source, file, passphrase)),
        { code: 'ENOSPC' },
        `budget ${budget}`
      )
      assert.deepEqual(
        await readdir(target),
        [],
        `no destination or pending file remains at budget ${budget}`
      )
      await validateBackup(source)
      assert.equal(await readFile(join(source, 'pgdata/data'), 'utf8'), record)
    }

    // The failed attempts must not wedge the next one once space is back.
    await sealDirectory(source, file, passphrase)
    const restored = join(root, 'restored')
    await unsealToDirectory(file, restored, passphrase)
    assert.equal(await readFile(join(restored, 'pgdata/data'), 'utf8'), record)
    await validateBackup(restored)
  }))

test('a full volume leaves an earlier backup beside it intact and restorable', async () =>
  fixture(async ({ root, source, target, file }) => {
    const earlier = join(target, 'earlier.tabackup')
    await sealDirectory(source, earlier, passphrase)
    const before = await readFile(earlier)
    await assert.rejects(
      withDiskFull(200, () => sealDirectory(source, file, passphrase)),
      { code: 'ENOSPC' }
    )
    assert.deepEqual(await readdir(target), ['earlier.tabackup'])
    assert.deepEqual(await readFile(earlier), before)
    const restored = join(root, 'restored')
    await unsealToDirectory(earlier, restored, passphrase)
    assert.equal(await readFile(join(restored, 'pgdata/data'), 'utf8'), record)
  }))

test('the disk-full error keeps a machine-readable cause for the caller', async () =>
  fixture(async ({ source, file }) => {
    const error = await withDiskFull(100, () =>
      sealDirectory(source, file, passphrase)
    ).then(
      () => assert.fail('backup must fail'),
      (caught) => caught
    )
    assert.equal(error.code, 'ENOSPC')
    assert.match(error.message, /no space left on device/)
  }))
