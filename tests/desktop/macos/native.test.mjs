import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const darwin = process.platform === 'darwin'
const guard = process.env.MAC_GUARD
const helper = process.env.MAC_VAULT
const exists = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function until(action) {
  for (let n = 0; n < 120; n++) {
    if (await action()) return
    await delay(100)
  }
  assert.fail('Native process deadline exceeded')
}
test(
  'owner SIGKILL terminates its real child and descendant; a second launch is refused',
  { skip: !darwin },
  async () => {
    assert.ok(guard)
    const state = await mkdtemp(join(tmpdir(), 'mac native ü '))
    const script = join(state, 'tree.mjs'),
      record = join(state, 'pids.json')
    await writeFile(
      script,
      `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(process.argv[2],JSON.stringify([process.pid,grand.pid]));setInterval(()=>{},1000);`
    )
    const child = spawn(
      guard,
      ['--run', join(state, 'lock'), process.execPath, script, record],
      { stdio: 'ignore' }
    )
    let ids
    try {
      await until(async () => {
        try {
          ids = JSON.parse(await readFile(record))
          return ids.length === 2
        } catch {
          return false
        }
      })
      const second = spawn(
        guard,
        [
          '--run',
          join(state, 'lock'),
          process.execPath,
          '-e',
          'process.exit(0)'
        ],
        { stdio: 'ignore' }
      )
      assert.equal(
        await new Promise((accept) => second.once('exit', accept)),
        73
      )
      child.kill('SIGKILL')
      await until(() => ids.every((pid) => !exists(pid)))
      assert.ok(ids.every((pid) => !exists(pid)))
      const restart = spawn(
        guard,
        [
          '--run',
          join(state, 'lock'),
          process.execPath,
          '-e',
          'process.exit(0)'
        ],
        { stdio: 'ignore' }
      )
      assert.equal(
        await new Promise((accept) => restart.once('exit', accept)),
        0
      )
    } finally {
      child.kill('SIGKILL')
      for (const pid of ids ?? []) if (exists(pid)) process.kill(pid, 'SIGKILL')
      await rm(state, { recursive: true, force: true })
    }
  }
)

test(
  'native Keychain stores, reads, refuses locked reads, deletes and excludes plaintext files',
  { skip: !darwin },
  async () => {
    assert.ok(helper)
    const directory = await mkdtemp(join(tmpdir(), 'mac vault ü '))
    const keychain = join(directory, 'synthetic.keychain-db'),
      password = 'SYNTHETIC-CANARY-KEYCHAIN-PASSWORD'
    const handle = `synthetic-${process.pid}`,
      value = 'SYNTHETIC-CANARY-KEYCHAIN-ACCESS'
    const command = (args) =>
      execFileSync('/usr/bin/security', args, { stdio: 'pipe' })
    const invoke = async (operation) => {
      const child = spawn(
        helper,
        ['--synthetic-test', '--synthetic-keychain', keychain],
        { stdio: ['pipe', 'pipe', 'ignore'] }
      )
      const chunks = []
      child.stdout.on('data', (chunk) => chunks.push(chunk))
      child.stdin.end(JSON.stringify({ operation, handle, value }))
      const code = await new Promise((accept) => child.once('close', accept))
      return { code, response: JSON.parse(Buffer.concat(chunks)) }
    }
    try {
      command(['create-keychain', '-p', password, keychain])
      command(['unlock-keychain', '-p', password, keychain])
      assert.equal((await invoke('store-fixture')).code, 0)
      assert.equal((await invoke('read')).response.value, value)
      command(['lock-keychain', keychain])
      assert.equal((await invoke('read')).response.status, 'vault-unavailable')
      command(['unlock-keychain', '-p', password, keychain])
      assert.equal((await invoke('remove')).code, 0)
      assert.equal((await invoke('read')).response.status, 'vault-unavailable')
      assert.ok(!(await readFile(keychain)).includes(Buffer.from(value)))
    } finally {
      try {
        command(['delete-keychain', keychain])
      } catch {}
      await rm(directory, { recursive: true, force: true })
    }
  }
)
