import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const state = `${config.state}-hard-kill`
const worker = spawn(
  process.execPath,
  ['apps/desktop/proof/hard-kill-worker.mjs', process.argv[2]],
  { stdio: 'ignore' }
)
const exited = new Promise((accept) =>
  worker.once('exit', (code, signal) => accept({ code, signal }))
)
let services
try {
  let ready
  for (let i = 0; i < 200; i++) {
    if (worker.exitCode !== null || worker.signalCode !== null)
      throw new Error('Hard-kill worker failed')
    try {
      ready = JSON.parse(
        await readFile(`${state}/hard-kill-ready.json`, 'utf8')
      )
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(100)
  }
  assert.ok(ready)
  assert.notEqual(
    Number(await readFile(`${state}/running.lock`, 'utf8')),
    worker.pid
  )
  await assert.rejects(nativeServices({ ...config, state }), /EEXIST/)
  const started = performance.now()
  worker.kill('SIGKILL')
  assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' })
  let released = false
  for (let i = 0; i < 200; i++) {
    try {
      await readFile(`${state}/running.lock`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      released = true
      break
    }
    await delay(100)
  }
  assert.ok(
    released,
    'Independent service owner must finish cleanup and release lock'
  )
  const cleanupMs = performance.now() - started
  for (const value of [ready.ports.auth, ready.ports.rest]) {
    const port = Number(value)
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
    )
  }
  services = await nativeServices({ ...config, state })
  assert.equal(
    (
      await services.psql(
        "SELECT count(*) FROM public.guild_config WHERE guild_code='SYN-COMMITTED';"
      )
    ).trim(),
    '1'
  )
  assert.equal(
    (
      await services.psql(
        "SELECT count(*) FROM public.guild_config WHERE guild_code='SYN-UNCOMMITTED';"
      )
    ).trim(),
    '0'
  )
  const evidence = {
    status: 'passed',
    cleanupMs,
    checks: [
      'live independent owner prevents duplicate activation',
      'coordinator SIGKILL triggers owner cleanup without stale-PID signalling',
      'native Auth and PostgREST endpoints close',
      'restart preserves committed rows and rolls back interrupted transaction'
    ],
    scope:
      'Coordinator death while service owner remains alive; simultaneous owner death still fails closed'
  }
  await writeFile(
    config.evidence.replace(/\.json$/, '-hard-kill.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  if (worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM')
    await exited
  }
  await services?.stop()
}
