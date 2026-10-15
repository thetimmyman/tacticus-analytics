import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

for (const mode of ['signalled proof', 'missing Node']) {
  test(
    `native proof reports failure for ${mode}`,
    { skip: process.platform !== 'linux' },
    async () => {
      const folder = await mkdtemp(join(tmpdir(), 'native proof failure '))
      try {
        if (mode === 'signalled proof') {
          const executable = join(folder, 'node')
          await writeFile(
            executable,
            `#!${process.execPath}\nprocess.kill(process.pid, 'SIGTERM')\n`
          )
          await chmod(executable, 0o755)
        }
        const env = { ...process.env, PATH: folder }
        delete env.DESKTOP_PROOF_CONFIG
        const result = spawnSync(
          process.execPath,
          [fileURLToPath(new URL('./run-all.mjs', import.meta.url))],
          {
            env,
            encoding: 'utf8',
            timeout: 30000
          }
        )
        assert.ifError(result.error)
        assert.equal(result.status, 1)
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    }
  )
}

test(
  'native proof dispatches current fresh and former-password device sessions without modifying the supplied configuration',
  {
    skip: process.platform !== 'linux'
  },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'native proof dispatch '))
    try {
      const bin = join(folder, 'bin')
      const stateRoot = join(folder, 'states')
      await mkdir(bin)
      await mkdir(stateRoot)
      const record = join(folder, 'commands.jsonl')
      const executable = join(bin, 'node')
      await writeFile(
        executable,
        `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({args})+String.fromCharCode(10));
`
      )
      await chmod(executable, 0o755)
      const configPath = join(folder, 'config.json')
      const source = JSON.stringify({
        state: join(stateRoot, 'workspace'),
        stateRoot,
        evidence: join(folder, 'original-evidence.json'),
        deviceSession: false,
        legacyPasswordWorkspace: true,
        application: {
          node: '/synthetic/node',
          directory: '/synthetic/application'
        }
      })
      await writeFile(configPath, source, { mode: 0o600 })
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./run-all.mjs', import.meta.url))],
        {
          env: {
            ...process.env,
            PATH: bin + ':' + process.env.PATH,
            DESKTOP_PROOF_CONFIG: configPath
          },
          encoding: 'utf8',
          timeout: 30000
        }
      )
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      const commands = (await readFile(record, 'utf8'))
        .trim()
        .split(String.fromCharCode(10))
        .map(JSON.parse)
      assert(
        !commands.some(
          ({ args }) =>
            args[0].endsWith('/recovery-journey.mjs') ||
            args[0].endsWith('/password-change-journey.mjs')
        )
      )
      const selected = commands.filter(({ args }) =>
        args[0].endsWith('/onboarding-journey.mjs')
      )
      assert.equal(selected.length, 2)
      const fresh = JSON.parse(await readFile(selected[0].args[1], 'utf8'))
      const former = JSON.parse(await readFile(selected[1].args[1], 'utf8'))
      assert.equal(fresh.deviceSession, true)
      assert.equal(former.deviceSession, true)
      assert.equal(fresh.legacyPasswordWorkspace, false)
      assert.equal(former.legacyPasswordWorkspace, true)
      assert.notEqual(fresh.evidence, former.evidence)
      assert.notEqual(fresh.evidence, JSON.parse(source).evidence)
      for (const { args } of selected)
        assert.equal((await stat(args[1])).mode & 0o777, 0o600)
      assert.equal(await readFile(configPath, 'utf8'), source)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }
)
