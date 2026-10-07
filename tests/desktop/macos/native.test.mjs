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
const treeScript = `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(process.argv[2],JSON.stringify([process.pid,grand.pid]));setInterval(()=>{},1000);`
async function launch(state) {
  const restart = spawn(
    guard,
    ['--run', join(state, 'lock'), process.execPath, '-e', 'process.exit(0)'],
    { stdio: 'ignore' }
  )
  return new Promise((accept) => restart.once('exit', accept))
}
async function startTree(state) {
  const script = join(state, 'tree.mjs'),
    record = join(state, 'pids.json')
  await writeFile(script, treeScript)
  const child = spawn(
    guard,
    ['--run', join(state, 'lock'), process.execPath, script, record],
    { stdio: 'ignore' }
  )
  let ids
  await until(async () => {
    try {
      ids = JSON.parse(await readFile(record))
      return ids.length === 2
    } catch {
      return false
    }
  })
  return { child, ids }
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
      // The watcher releases the lock just after the tree is gone.
      await until(async () => (await launch(state)) === 0)
    } finally {
      child.kill('SIGKILL')
      for (const pid of ids ?? []) if (exists(pid)) process.kill(pid, 'SIGKILL')
      await rm(state, { recursive: true, force: true })
    }
  }
)

for (const signal of ['SIGTERM', 'SIGHUP'])
  test(
    `owner ${signal} stops its real child and descendant and releases the lock`,
    { skip: !darwin },
    async () => {
      assert.ok(guard)
      const state = await mkdtemp(join(tmpdir(), 'mac native ü '))
      let tree
      try {
        tree = await startTree(state)
        const exited = new Promise((accept) => tree.child.once('exit', accept))
        tree.child.kill(signal)
        assert.equal(await exited, 130)
        await until(() => tree.ids.every((pid) => !exists(pid)))
        assert.equal(await launch(state), 0)
      } finally {
        tree?.child.kill('SIGKILL')
        for (const pid of tree?.ids ?? [])
          if (exists(pid)) process.kill(pid, 'SIGKILL')
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
      execFileSync('/usr/bin/security', args, { stdio: 'pipe', timeout: 15000 })
    const invoke = async (operation) => {
      const child = spawn(
        helper,
        ['--synthetic-test', '--synthetic-keychain', keychain],
        { stdio: ['pipe', 'pipe', 'ignore'] }
      )
      const chunks = []
      const deadline = setTimeout(() => child.kill('SIGKILL'), 15000)
      child.stdout.on('data', (chunk) => chunks.push(chunk))
      child.stdin.end(JSON.stringify({ operation, handle, value }))
      const code = await new Promise((accept) => child.once('close', accept))
      clearTimeout(deadline)
      assert.notEqual(
        code,
        null,
        `Native Keychain ${operation} exceeded deadline`
      )
      return { code, response: JSON.parse(Buffer.concat(chunks)) }
    }
    try {
      command(['create-keychain', '-p', password, keychain])
      command(['unlock-keychain', '-p', password, keychain])
      assert.equal((await invoke('store-fixture')).code, 0)
      const initialRead = await invoke('read')
      assert.equal(
        initialRead.code,
        0,
        JSON.stringify({
          status: initialRead.response.status,
          errorCode: initialRead.response.errorCode
        })
      )
      assert.equal(initialRead.response.value, value)
      command(['lock-keychain', keychain])
      const lockedRead = await invoke('read')
      assert.equal(lockedRead.code, 1)
      assert.equal(
        lockedRead.response.status,
        'vault-locked',
        JSON.stringify(lockedRead.response)
      )
      command(['unlock-keychain', '-p', password, keychain])
      assert.equal((await invoke('remove')).code, 0)
      assert.equal((await invoke('read')).response.status, 'credential-missing')
      assert.ok(!(await readFile(keychain)).includes(Buffer.from(value)))
    } finally {
      try {
        command(['delete-keychain', keychain])
      } catch {}
      await rm(directory, { recursive: true, force: true })
    }
  }
)
