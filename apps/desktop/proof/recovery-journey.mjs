import { strict as assert } from 'node:assert'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const assets = join(dirname(fileURLToPath(import.meta.url)), '../launcher')
const state = join(config.stateRoot, `recovery-${randomUUID()}`)
const original = randomBytes(24).toString('hex')
const replacement = randomBytes(24).toString('hex')
let services, gateway, request
const start = async () => {
  services = await nativeServices({ ...config, state })
  const key = randomBytes(32).toString('hex')
  gateway = await loopbackGateway({
    services,
    transportKey: key,
    handleLocalRequest: workspaceSetup(services, assets)
  })
  request = (path, body, headers = {}) =>
    fetch(`${gateway.origin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-desktop-transport': key,
        ...headers
      },
      body: JSON.stringify(body)
    })
}
const stop = async () => {
  if (gateway) await gateway.stop()
  if (services) await services.stop()
}
const login = (password) =>
  fetch(`http://127.0.0.1:${services.ports.auth}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'desktop@localhost.invalid', password })
  })
try {
  await start()
  assert.equal(
    (await request('/desktop/setup', { password: original, sample: true }))
      .status,
    201
  )
  const rows = (
    await services.psql(
      'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
    )
  ).trim()
  const before = await (await login(original)).json()
  assert.ok(before.refresh_token)
  for (const path of ['/desktop/recovery-code', '/desktop/reset-password']) {
    assert.equal(
      (
        await request(
          path,
          { password: replacement, code: '0'.repeat(64) },
          { Origin: 'https://foreign.invalid' }
        )
      ).status,
      403
    )
    assert.equal(
      (await fetch(`${gateway.origin}${path}`, { method: 'POST', body: '{}' }))
        .status,
      403
    )
  }
  assert.equal(
    (await request('/desktop/recovery-code', { password: replacement })).status,
    401
  )
  assert.equal(
    (await request('/desktop/recovery-code', { password: original })).status,
    429
  )
  await delay(3100)
  const saved = await request('/desktop/recovery-code', { password: original })
  assert.equal(saved.status, 201)
  const { code } = await saved.json()
  assert.match(code, /^[a-f0-9]{64}$/)
  const ledger = (
    await services.psql(
      'SELECT recovery_code_hash FROM public.desktop_preview_setup;'
    )
  ).trim()
  assert.match(ledger, /^[a-f0-9]{64}$/)
  assert.notEqual(ledger, code)
  for (const role of [
    'anon',
    'authenticated',
    'service_role',
    'desktop_rpc_reader'
  ])
    await assert.rejects(
      services.psql(
        `BEGIN; SET LOCAL ROLE ${role}; SELECT recovery_code_hash FROM public.desktop_preview_setup; ROLLBACK;`
      )
    )
  await delay(3100)
  assert.equal(
    (
      await request('/desktop/reset-password', {
        password: replacement,
        code: '0'.repeat(64)
      })
    ).status,
    401
  )
  await delay(3100)
  assert.equal(
    (await request('/desktop/reset-password', { password: replacement, code }))
      .status,
    200
  )
  assert.equal((await login(original)).status, 400)
  assert.equal((await login(replacement)).status, 200)
  const refresh = await fetch(
    `http://127.0.0.1:${services.ports.auth}/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: before.refresh_token })
    }
  )
  assert.equal(refresh.status, 400)
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
      )
    ).trim(),
    rows
  )
  await stop()
  await start()
  // Repeat after restart simulates a committed reset whose response was lost.
  assert.equal(
    (await request('/desktop/reset-password', { password: replacement, code }))
      .status,
    200
  )
  assert.equal((await login(replacement)).status, 200)
  await delay(3100)
  const renewed = await request('/desktop/recovery-code', {
    password: replacement
  })
  assert.equal(renewed.status, 201)
  const second = (await renewed.json()).code
  assert.notEqual(second, code)
  await delay(3100)
  assert.equal(
    (await request('/desktop/reset-password', { password: original, code }))
      .status,
    401
  )
  await delay(3100)
  assert.equal(
    (
      await request('/desktop/reset-password', {
        password: original,
        code: second
      })
    ).status,
    200
  )
  assert.equal((await login(original)).status, 200)
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
      )
    ).trim(),
    rows
  )
  const evidence = {
    status: 'passed',
    checks: [
      'wrong origin and missing transport rejected',
      'wrong password and code rejected; attempts throttled',
      'recovery ledger denied to every API/read role',
      'stored digest differs from code',
      'new password works; old password and refresh session rejected',
      'restart and lost-response retry preserve recovery and eight rows',
      'replacing recovery code invalidates the old code'
    ],
    scope:
      'Native local Auth/SQL and gateway; no email or hosted identity; saved code remains reusable until explicitly replaced'
  }
  await writeFile(
    config.evidence.replace('.json', '-recovery.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await stop()
}
