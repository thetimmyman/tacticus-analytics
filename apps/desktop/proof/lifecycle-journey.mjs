import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { spawn } from 'node:child_process'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const local = {
  ...config,
  state: `${config.state}-lifecycle`,
  tokenLifetimeSeconds: 1
}
let services = await nativeServices(local)
let gateway
const checks = []
try {
  const transportKey = randomBytes(32).toString('hex')
  gateway = await loopbackGateway({ services, transportKey })
  const expired = services.token.service
  await delay(3000)
  const direct = await fetch(
    `http://127.0.0.1:${services.ports.auth}/admin/users`,
    {
      headers: { Authorization: `Bearer ${expired}` }
    }
  )
  assert.ok([401, 403].includes(direct.status))
  const privileged = await fetch(
    `${gateway.origin}/supabase/auth/v1/admin/users`,
    {
      headers: {
        'x-desktop-transport': transportKey,
        Authorization: `Bearer ${services.serviceCredential}`
      }
    }
  )
  assert.equal(privileged.status, 200)
  const anonymous = await fetch(`${gateway.origin}/supabase/rest/v1/`, {
    headers: {
      'x-desktop-transport': transportKey,
      Authorization: 'Bearer desktop-public'
    }
  })
  assert.equal(anonymous.status, 200)
  const forged = await fetch(`${gateway.origin}/supabase/auth/v1/admin/users`, {
    headers: {
      'x-desktop-transport': transportKey,
      Authorization: 'Bearer desktop-public'
    }
  })
  assert.ok([401, 403].includes(forged.status))
  checks.push(
    'expired native JWT rejected',
    'stable private server credential obtains fresh native JWT',
    'anonymous gateway token renewed',
    'anonymous credential cannot become service role'
  )

  await services.psql(
    "INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(99,'SYN-LIFE','Synthetic lifecycle control');"
  )
  const sleeping = services.psql('SELECT pg_sleep(30);').then(
    () => false,
    () => true
  )
  for (let i = 0; i < 50; i++) {
    const active = (
      await services.psql(
        "SELECT count(*) FROM pg_stat_activity WHERE query='SELECT pg_sleep(30);' AND state='active';"
      )
    ).trim()
    if (active === '1') break
    if (i === 49) throw new Error('Long-running query never became active')
    await delay(100)
  }
  await gateway.stop()
  gateway = undefined
  const postgres = services.children[0]
  const started = performance.now()
  await services.stop()
  const stopMs = performance.now() - started
  assert.ok(
    services.children.every((child) => child.signalCode !== 'SIGKILL'),
    'Shutdown must not forcibly kill a managed service'
  )
  assert.equal(postgres.exitCode, 0)
  assert.equal(postgres.signalCode, null)
  assert.equal(await sleeping, true)
  services = await nativeServices(local)
  assert.equal(
    (
      await services.psql(
        "SELECT count(*) FROM public.guild_config WHERE guild_code='SYN-LIFE';"
      )
    ).trim(),
    '1'
  )
  checks.push(
    'active SQL cancelled by clean PostgreSQL fast shutdown',
    'restart retains committed synthetic data'
  )
  await services.stop()
  const worker = spawn(
    process.execPath,
    [new URL('./signal-worker.mjs', import.meta.url).pathname, process.argv[2]],
    { stdio: 'ignore' }
  )
  const exited = new Promise((accept) =>
    worker.once('exit', (code, signal) => accept({ code, signal }))
  )
  try {
    let ready = false
    for (let i = 0; i < 200; i++) {
      if (worker.exitCode !== null || worker.signalCode !== null)
        throw new Error('Signal worker failed before readiness')
      try {
        await readFile(`${config.state}-signals/signal-ready`)
        ready = true
        break
      } catch {}
      await delay(100)
    }
    assert.ok(ready, 'Signal worker must become ready')
    worker.kill('SIGTERM')
    await delay(20)
    worker.kill('SIGTERM')
    const result = await Promise.race([
      exited,
      delay(10000).then(() => {
        throw new Error('Signal shutdown timed out')
      })
    ])
    assert.deepEqual(result, { code: 130, signal: null })
    await assert.rejects(readFile(`${config.state}-signals/running.lock`), {
      code: 'ENOENT'
    })
    services = await nativeServices({
      ...config,
      state: `${config.state}-signals`
    })
    assert.equal(
      (
        await services.psql(
          "SELECT count(*) FROM public.guild_config WHERE guild_code='SYN-SIGNAL';"
        )
      ).trim(),
      '1'
    )
    checks.push(
      'repeated coordinator SIGTERM completes cleanup',
      'signal shutdown releases lock and restart retains data'
    )
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await exited
    }
  }
  await writeFile(
    config.evidence.replace('.json', '-lifecycle.json'),
    JSON.stringify({ checks, stopMs, tokenLifetimeSeconds: 1 }, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify({ checks: checks.length, stopMs, passed: true }))
} finally {
  if (gateway) await gateway.stop()
  await services.stop()
}
