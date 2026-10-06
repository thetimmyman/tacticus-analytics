import { test, after } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  symlink,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  selectedWorkspace,
  selectWorkspace
} from '../launcher/workspace-selection.mjs'
const folders = []
after(async () => {
  for (const path of folders) await rm(path, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-selection-'))
  folders.push(root)
  const original = join(root, 'original'),
    restored = join(root, 'restored')
  await mkdir(original, { mode: 0o700 })
  await mkdir(restored, { mode: 0o700 })
  return { root, original, restored }
}
test('a restored private workspace becomes the durable selection while explicit source data stays in place', async () => {
  const f = await fixture()
  await writeFile(join(f.original, 'preserved-data'), 'original', {
    mode: 0o600
  })
  assert.equal(await selectedWorkspace(f.original), f.original)
  await selectWorkspace(f.original, f.restored)
  assert.equal(await selectedWorkspace(f.original), f.restored)
  assert.equal(
    await readFile(join(f.original, 'preserved-data'), 'utf8'),
    'original'
  )
})
test('selection refuses linked pointer files and permissive destination folders', async () => {
  const f = await fixture()
  const pointer = join(f.root, 'pointer')
  await writeFile(
    pointer,
    JSON.stringify({
      format: 'desktop-workspace-selection-v1',
      state: f.restored
    }),
    { mode: 0o600 }
  )
  await symlink(pointer, join(f.original, 'active-workspace.json'))
  await assert.rejects(
    selectedWorkspace(f.original),
    /Invalid workspace selection/
  )
  await chmod(f.restored, 0o755)
  await assert.rejects(
    selectWorkspace(f.original, f.restored),
    /private owned directory/
  )
})
test('relative and malformed persisted selections cannot redirect startup', async () => {
  const f = await fixture()
  const path = join(f.original, 'active-workspace.json')
  await writeFile(
    path,
    JSON.stringify({
      format: 'desktop-workspace-selection-v1',
      state: '../outside'
    }),
    { mode: 0o600 }
  )
  await assert.rejects(
    selectedWorkspace(f.original),
    /Invalid workspace selection/
  )
  await writeFile(path, 'null', { mode: 0o600 })
  await assert.rejects(selectedWorkspace(f.original))
})
