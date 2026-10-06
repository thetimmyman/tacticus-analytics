import { test, after } from 'node:test'
import { strict as assert } from 'node:assert'
import { randomUUID, randomBytes } from 'node:crypto'
import {
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  symlink,
  rm,
  stat
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadGameConnection,
  saveGameConnection,
  forgetGameConnection
} from '../launcher/saved-game-connection.mjs'
const roots = []
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-connection-'))
  roots.push(root)
  return {
    root,
    path: join(root, 'official-raid-connection.json'),
    record: {
      installation: randomUUID(),
      guildId: randomUUID(),
      guildCode: 'SYN001',
      handle: randomBytes(16).toString('hex'),
      expiresAt: 2_000_000_000_000
    }
  }
}
test('an owner-only bounded record persists opaque metadata and can be removed idempotently', async () => {
  const f = await fixture()
  assert.equal(await loadGameConnection(f.root), null)
  await saveGameConnection(f.root, f.record)
  assert.deepEqual(await loadGameConnection(f.root), f.record)
  assert.equal((await stat(f.path)).mode & 511, 384)
  await saveGameConnection(f.root, {
    ...f.record,
    expiresAt: 2_000_000_001_000
  })
  assert.equal((await loadGameConnection(f.root)).expiresAt, 2_000_000_001_000)
  await forgetGameConnection(f.root)
  await forgetGameConnection(f.root)
  assert.equal(await loadGameConnection(f.root), null)
})
test('credentials, arbitrary operations, invalid handles and malformed saved identity cannot enter persistence', async () => {
  const f = await fixture()
  for (const patch of [
    { secret: randomUUID() },
    { url: 'https://foreign.invalid' },
    { handle: '../outside' },
    { installation: null },
    { installation: [f.record.installation] },
    { handle: [f.record.handle] },
    { expiresAt: -1 },
    { guildCode: '<script>' }
  ])
    await assert.rejects(saveGameConnection(f.root, { ...f.record, ...patch }))
  await assert.rejects(stat(f.path), { code: 'ENOENT' })
})
test('links and permissive files refuse read, overwrite and cleanup without touching their targets', async () => {
  const f = await fixture(),
    target = join(f.root, 'target')
  await writeFile(target, 'preserved', { mode: 384 })
  await symlink(target, f.path)
  for (const operation of [
    () => loadGameConnection(f.root),
    () => saveGameConnection(f.root, f.record),
    () => forgetGameConnection(f.root)
  ])
    await assert.rejects(operation())
  assert.equal(await readFile(target, 'utf8'), 'preserved')
  await rm(f.path)
  await saveGameConnection(f.root, f.record)
  await chmod(f.path, 420)
  await assert.rejects(loadGameConnection(f.root))
  await assert.rejects(saveGameConnection(f.root, f.record))
  await assert.rejects(forgetGameConnection(f.root))
})
test('malformed, oversized, linked and shared directories cannot supply a connection', async () => {
  const f = await fixture()
  await writeFile(f.path, 'null', { mode: 384 })
  await assert.rejects(loadGameConnection(f.root))
  await writeFile(f.path, ' '.repeat(8193))
  await assert.rejects(loadGameConnection(f.root))
  await chmod(f.root, 493)
  await assert.rejects(loadGameConnection(f.root))
  await assert.rejects(saveGameConnection(f.root, f.record))
})
