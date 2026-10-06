import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  stat,
  open,
  rename,
  chmod
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createWorkspace,
  resetWorkspace,
  withWorkspaceLock,
  snapshotState,
  restoreState,
  boundedDiskPressure,
  checkWorkspace,
  readPrivateMarker
} from '../../apps/platform-lab/workspace.mjs'

export async function temporaryLab() {
  return realpath(await mkdtemp(join(tmpdir(), 'synthetic-platform-test-')))
}
test('reset refuses unmarked and locked paths and preserves outside data and evidence', async () => {
  const base = await temporaryLab()
  try {
    const outside = join(base, 'owner-data')
    await writeFile(outside, 'retained')
    await assert.rejects(resetWorkspace(base))
    const workspace = await createWorkspace(base)
    await writeFile(join(workspace, 'state', 'synthetic-data'), 'fixture')
    await writeFile(join(workspace, 'evidence.json'), 'retained evidence')
    await withWorkspaceLock(workspace, async () => {
      await assert.rejects(resetWorkspace(workspace), /EEXIST/)
      await assert.rejects(snapshotState(workspace, 'baseline'), /EEXIST/)
      await assert.rejects(restoreState(workspace, 'baseline'), /EEXIST/)
    })
    await resetWorkspace(workspace)
    assert.deepEqual(await readdir(join(workspace, 'state')), [])
    assert.equal(await readFile(outside, 'utf8'), 'retained')
    assert.equal(
      await readFile(join(workspace, 'evidence.json'), 'utf8'),
      'retained evidence'
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
test(
  'symlink and marker redirection cannot reset or snapshot an outside directory',
  { skip: process.platform === 'win32' },
  async () => {
    const base = await temporaryLab()
    try {
      const workspace = await createWorkspace(base)
      const outside = join(base, 'owner-data')
      await writeFile(outside, 'retained')
      await symlink(outside, join(workspace, 'state', 'redirect'))
      await assert.rejects(resetWorkspace(workspace), /Symlink/)
      await assert.rejects(snapshotState(workspace, 'baseline'), /Symlink/)
      assert.equal(await readFile(outside, 'utf8'), 'retained')
      await rm(join(workspace, 'state', 'redirect'))
      const markerPath = join(workspace, '.platform-lab-disposable.json')
      const marker = JSON.parse(await readFile(markerPath, 'utf8'))
      await writeFile(markerPath, JSON.stringify({ ...marker, path: base }))
      await assert.rejects(resetWorkspace(workspace), /mismatch/)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  }
)
test(
  'opened marker cannot be redirected by a directory-entry replacement',
  { skip: process.platform === 'win32' },
  async () => {
    const base = await temporaryLab()
    try {
      const workspace = await createWorkspace(base)
      const markerPath = join(workspace, '.platform-lab-disposable.json')
      const expected = JSON.parse(await readFile(markerPath, 'utf8'))
      const outside = join(base, 'outside-marker')
      await writeFile(outside, '{"redirected":true}', { mode: 0o600 })
      const handle = await open(markerPath, 'r')
      try {
        await rename(markerPath, join(workspace, 'original-marker'))
        await symlink(outside, markerPath)
        assert.deepEqual(await readPrivateMarker(handle), expected)
        await assert.rejects(checkWorkspace(workspace), /ELOOP|marker/)
        await assert.rejects(resetWorkspace(workspace), /ELOOP|marker/)
        assert.equal(await readFile(outside, 'utf8'), '{"redirected":true}')
      } finally {
        await handle.close()
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  }
)
test(
  'marker descriptor rejects public permissions and oversized content',
  { skip: process.platform === 'win32' },
  async () => {
    const base = await temporaryLab()
    try {
      const workspace = await createWorkspace(base)
      const markerPath = join(workspace, '.platform-lab-disposable.json')
      await chmod(markerPath, 0o644)
      await assert.rejects(checkWorkspace(workspace), /Private owned/)
      await chmod(markerPath, 0o600)
      await writeFile(markerPath, 'x'.repeat(4097))
      await assert.rejects(checkWorkspace(workspace), /Private owned/)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  }
)
test('synthetic state snapshot restores repeatably and pressure is bounded and cleaned', async () => {
  const base = await temporaryLab()
  try {
    const workspace = await createWorkspace(base)
    await writeFile(join(workspace, 'state', 'data'), 'baseline')
    await snapshotState(workspace, 'baseline')
    await writeFile(join(workspace, 'state', 'data'), 'changed')
    await restoreState(workspace, 'baseline')
    assert.equal(
      await readFile(join(workspace, 'state', 'data'), 'utf8'),
      'baseline'
    )
    await assert.rejects(snapshotState(workspace, '../outside'))
    await assert.rejects(
      boundedDiskPressure(workspace, 65 * 1024 * 1024, async () => {})
    )
    await assert.rejects(
      boundedDiskPressure(workspace, 8192, async () => {
        assert.equal(
          (await stat(join(workspace, 'state', 'disk-pressure.bin'))).size,
          8192
        )
        throw new Error('Injected storage failure')
      }),
      /Injected/
    )
    assert.deepEqual(await readdir(join(workspace, 'state')), ['data'])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
