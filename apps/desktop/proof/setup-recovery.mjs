import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

// Disposable native-service fault exercise. No game credentials or captured data.
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const assets = join(dirname(fileURLToPath(import.meta.url)), '../launcher')
const results = []
for (const phase of ['before-import', 'during-import', 'after-commit']) {
  const password = randomBytes(24).toString('hex')
  const state = join(config.stateRoot, phase)
  let services, gateway
  const start = async (fault) => {
    services = await nativeServices({ ...config, state })
    const original = services.psql
    const injected = {
      ...services,
      psql: async (sql) => {
        if (!fault || !sql.startsWith('BEGIN;')) return original(sql)
        if (phase === 'before-import') throw new Error('Injected interruption')
        if (phase === 'during-import')
          return original(sql.replace('COMMIT;', 'SELECT 1/0; COMMIT;'))
        await original(sql)
        throw new Error('Injected lost completion response')
      }
    }
    const transportKey = randomBytes(32).toString('hex')
    gateway = await loopbackGateway({
      services,
      transportKey,
      handleLocalRequest: workspaceSetup(injected, assets)
    })
    return async (password) =>
      fetch(`${gateway.origin}/desktop/setup`, {
        method: 'POST',
        headers: {
          'x-desktop-transport': transportKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ password, sample: true })
      })
  }
  const stop = async () => {
    if (gateway) await gateway.stop()
    gateway = undefined
    if (services) await services.stop()
    services = undefined
  }
  const snapshot = async () =>
    JSON.parse(
      (
        await services.psql(`SELECT json_build_object(
      'accounts',(SELECT count(*) FROM auth.users),
      'raids',(SELECT count(*) FROM public."EOT_GR_data"),
      'completed',(SELECT count(*) FROM public.desktop_preview_setup)
    );`)
      ).trim()
    )
  try {
    let request = await start(true)
    assert.equal((await request(password)).status, 500)
    assert.deepEqual(await snapshot(), {
      accounts: 1,
      raids: phase === 'after-commit' ? 8 : 0,
      completed: phase === 'after-commit' ? 1 : 0
    })
    await stop()
    request = await start(false)
    assert.equal(
      (await request('incorrect-password-for-control')).status,
      phase === 'after-commit' ? 409 : 401
    )
    assert.equal(
      (await request(password)).status,
      phase === 'after-commit' ? 409 : 201
    )
    assert.equal((await request(password)).status, 409)
    assert.deepEqual(await snapshot(), { accounts: 1, raids: 8, completed: 1 })
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(
        services.psql(
          `SET ROLE ${role}; SELECT * FROM public.desktop_preview_setup;`
        )
      )
    }
    results.push({
      phase,
      recovered: true,
      duplicateSetupDenied: true,
      originalPasswordRequired: phase !== 'after-commit',
      privateLedger: true
    })
  } finally {
    await stop()
  }
}
// Unexpected data is preserved and blocks sample creation, even with valid input.
const services = await nativeServices({
  ...config,
  state: join(config.stateRoot, 'occupied')
})
let gateway
try {
  await services.psql(
    "INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(99,'SYN-GUARD','Synthetic preservation control');"
  )
  const transportKey = randomBytes(32).toString('hex')
  gateway = await loopbackGateway({
    services,
    transportKey,
    handleLocalRequest: workspaceSetup(services, assets)
  })
  const response = await fetch(`${gateway.origin}/desktop/setup`, {
    method: 'POST',
    headers: {
      'x-desktop-transport': transportKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      password: randomBytes(24).toString('hex'),
      sample: true
    })
  })
  assert.equal(response.status, 500)
  assert.equal(
    (await services.psql('SELECT count(*) FROM public.guild_config;')).trim(),
    '1'
  )
  assert.equal(
    (await services.psql('SELECT count(*) FROM auth.users;')).trim(),
    '0'
  )
  assert.equal(
    (
      await services.psql('SELECT count(*) FROM public.desktop_preview_setup;')
    ).trim(),
    '0'
  )
  results.push({
    phase: 'unexpected-data',
    preserved: true,
    accountNotCreated: true
  })
} finally {
  if (gateway) await gateway.stop()
  await services.stop()
}
await writeFile(config.evidence, JSON.stringify({ results }, null, 2), {
  mode: 0o600
})
console.log(JSON.stringify({ phases: results.length, passed: true }))
