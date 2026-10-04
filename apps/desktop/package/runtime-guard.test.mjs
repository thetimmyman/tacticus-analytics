import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  symlink,
  writeFile,
  readFile,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test(
  'kernel guard rejects competing activation and unsafe lease files',
  { skip: process.platform !== 'linux' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-kernel-guard-'))
    let holder
    try {
      const binary = join(root, 'guard')
      const built = spawnSync('cc', [
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        fileURLToPath(new URL('./runtime-guard.c', import.meta.url)),
        '-o',
        binary
      ])
      assert.equal(built.status, 0, built.stderr?.toString())
      const state = join(root, 'state')
      await mkdir(state, { mode: 0o700 })
      const args = [
        '--owner',
        state,
        process.execPath,
        '-e',
        "console.log('ready'); setInterval(()=>{},1000)"
      ]
      holder = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      const closed = new Promise((accept) => holder.once('close', accept))
      await new Promise((accept, reject) => {
        holder.stdout.once('data', accept)
        holder.once('error', reject)
        holder.once('exit', () =>
          reject(new Error('Lease holder exited before readiness'))
        )
      })
      assert.equal(spawnSync(binary, args).status, 73)
      holder.kill('SIGKILL')
      await closed
      const restarted = spawnSync(binary, [
        '--owner',
        state,
        process.execPath,
        '-e',
        'process.exit(0)'
      ])
      assert.equal(restarted.status, 0)
      const unsafe = join(root, 'unsafe')
      await mkdir(unsafe, { mode: 0o700 })
      const target = join(root, 'untouched')
      await writeFile(target, 'synthetic control', { mode: 0o600 })
      await symlink(target, join(unsafe, 'runtime.lease'))
      assert.equal(
        spawnSync(binary, [
          '--owner',
          unsafe,
          process.execPath,
          '-e',
          'process.exit(0)'
        ]).status,
        77
      )
      assert.equal(await readFile(target, 'utf8'), 'synthetic control')
    } finally {
      if (holder?.exitCode === null && holder.signalCode === null)
        holder.kill('SIGKILL')
      await rm(root, { recursive: true, force: true })
    }
  }
)
