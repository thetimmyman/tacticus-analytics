import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
if (!config.runtimeGuard)
  throw new Error('Owner-death proof requires the native runtime guard')
const state = `${config.state}-owner-death`
const worker = spawn(
  process.execPath,
  ['apps/desktop/proof/owner-death-worker.mjs', process.argv[2]],
  { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
)
const exited = new Promise((accept) => worker.once('exit', accept))
let services
try {
  let ready
  for (let i = 0; i < 200; i++) {
    if (worker.exitCode !== null || worker.signalCode !== null)
      throw new Error('Owner-death worker failed')
    try {
      ready = JSON.parse(
        await readFile(`${state}/owner-death-ready.json`, 'utf8')
      )
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(100)
  }
  assert.ok(ready)
  const record = await readFile(`${state}/running.lock`, 'utf8')
  assert.equal(JSON.parse(record).format, 'desktop-kernel-lease-v1')
  await assert.rejects(nativeServices({ ...config, state }), { code: 'EEXIST' })
  const killed = new Promise((accept) => worker.once('message', accept))
  worker.send({ killOwner: true })
  assert.deepEqual(await killed, { killed: true })
  worker.kill('SIGKILL')
  await exited
  // Owner death cannot remove the journal; the new activation must reconcile it
  // using the exclusive kernel lease, without manually deleting either file.
  assert.equal(await readFile(`${state}/running.lock`, 'utf8'), record)
  const started = performance.now()
  for (let i = 0; i < 100; i++) {
    try {
      services = await nativeServices({ ...config, state })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    await delay(100)
  }
  assert.ok(
    services,
    'Kernel lease must become available after owned services die'
  )
  for (const value of [ready.ports.auth, ready.ports.rest]) {
    const port = Number(value)
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
    )
  }
  assert.equal(
    (
      await services.psql(
        "SELECT count(*) FROM public.guild_config WHERE guild_code='SYN-DURABLE';"
      )
    ).trim(),
    '1'
  )
  assert.equal(
    (
      await services.psql(
        "SELECT count(*) FROM public.guild_config WHERE guild_code='SYN-INTERRUPTED';"
      )
    ).trim(),
    '0'
  )
  const evidence = {
    status: 'passed',
    restartMs: performance.now() - started,
    checks: [
      'native services inherit the exclusive kernel lease',
      'live lease blocks duplicate activation',
      'supervisor and coordinator SIGKILL terminate native services',
      'stale managed journal recovered without deletion or PID signalling',
      'PostgreSQL crash recovery retains committed data and rolls back interrupted SQL'
    ],
    scope:
      'Linux native runtime guard; legacy unknown locks and real power-loss testing remain separate'
  }
  await writeFile(
    config.evidence.replace(/\.json$/, '-owner-death.json'),
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
