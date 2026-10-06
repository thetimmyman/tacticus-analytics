import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { launcherOptions } from '../launcher/options.mjs'

test('ambiguous or malformed launch arguments fail before workspace creation or selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-options-'))
  try {
    const sentinel = randomBytes(32).toString('hex')
    const destination = join(root, sentinel)
    const invalid = [
      ['--state'],
      ['--state', '--restore', destination],
      ['--restore', destination],
      ['--restore', destination, '--state'],
      ['--state', destination, '--state', destination],
      [
        '--backup',
        destination,
        '--restore',
        destination,
        '--state',
        destination
      ],
      [
        '--state',
        destination,
        '--verify',
        destination,
        '--restore',
        destination
      ],
      ['--unexpected', sentinel],
      ['--state', '']
    ]
    for (const args of invalid) {
      const result = spawnSync(
        process.execPath,
        ['apps/desktop/launcher/launch.mjs', ...args],
        {
          cwd: new URL('../../..', import.meta.url).pathname,
          env: { PATH: process.env.PATH, HOME: root },
          encoding: 'utf8',
          timeout: 10000
        }
      )
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Invalid desktop launch options/)
      assert.equal((result.stderr + result.stdout).includes(sentinel), false)
      assert.deepEqual(await readdir(root), [])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('normal launch and explicit workspace transfers have unambiguous paths', () => {
  assert.equal(launcherOptions([]).size, 0)
  assert.equal(
    launcherOptions(['--state', '/workspace']).get('--state'),
    '/workspace'
  )
  assert.equal(
    launcherOptions(['--backup', '/backup']).get('--backup'),
    '/backup'
  )
  assert.equal(
    launcherOptions(['--state', '/new-workspace', '--restore', '/backup']).get(
      '--restore'
    ),
    '/backup'
  )
})
