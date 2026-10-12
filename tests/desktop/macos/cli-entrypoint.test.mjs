import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('installed qualification entrypoints execute through symlinked parent directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-cli-entrypoint-'))
  try {
    const target = resolve('apps/desktop/platform/macos')
    const alias = join(directory, 'installed application')
    await symlink(target, alias, 'dir')
    for (const [file, message] of [
      ['network-isolation.mjs', 'External IPv4 qualification target required'],
      ['window-broker.mjs', 'Native macOS owner required']
    ]) {
      const result = spawnSync(
        process.execPath,
        [join(alias, file), '127.0.0.1'],
        {
          env: { PATH: process.env.PATH },
          encoding: 'utf8',
          timeout: 5000
        }
      )
      assert.notEqual(result.status, 0)
      assert.ok(result.stderr.includes(message), result.stderr)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
