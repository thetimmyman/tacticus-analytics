import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  symlink,
  rm,
  lstat
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withEntry, copyRegularTree, readBounded } from './safe-files.mjs'

test('descriptor reads keep the checked inode when its name is replaced by a link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-inode-'))
  try {
    const input = join(root, 'input'),
      outside = join(root, 'outside')
    await writeFile(input, 'checked contents')
    await writeFile(outside, 'foreign contents')
    await withEntry(input, async (file) => {
      await rename(input, join(root, 'original'))
      await symlink(outside, input)
      assert.equal(
        (await readBounded(file, 100)).toString(),
        'checked contents'
      )
    })
    await assert.rejects(
      withEntry(input, async () => {}),
      /linked/i
    )
    await withEntry(outside, async (file) =>
      assert.rejects(readBounded(file, 4), /permitted size/)
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('directory descriptor keeps copied writes inside the opened root after pathname replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-directory-inode-'))
  try {
    const directory = join(root, 'directory'),
      moved = join(root, 'moved'),
      outside = join(root, 'outside'),
      input = join(root, 'input')
    await mkdir(directory, { mode: 0o700 })
    await mkdir(outside, { mode: 0o700 })
    await writeFile(input, 'safe copy')
    await withEntry(directory, async (_file, _metadata, anchor) => {
      await rename(directory, moved)
      await symlink(outside, directory)
      await copyRegularTree(input, join(anchor, 'copy'))
    })
    assert.equal(await readFile(join(moved, 'copy'), 'utf8'), 'safe copy')
    await assert.rejects(lstat(join(outside, 'copy')), { code: 'ENOENT' })
    await assert.rejects(
      copyRegularTree(directory, join(root, 'rejected')),
      /linked/i
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
