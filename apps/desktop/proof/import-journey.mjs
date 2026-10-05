import { strict as assert } from 'node:assert'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
if (!config.application)
  throw new Error(
    'A real compiled desktop application is required for import proof'
  )
const state = join(
  config.stateRoot || config.state,
  `file-import-${randomUUID()}`
)
const services = await nativeServices({ ...config, state })
const key = randomBytes(32).toString('hex'),
  cron = randomBytes(32).toString('hex'),
  password = randomBytes(24).toString('hex')
const listener = createServer()
await new Promise((accept) => listener.listen(0, '127.0.0.1', accept))
const port = listener.address().port
await new Promise((accept) => listener.close(accept))
const gateway = await loopbackGateway({
  services,
  transportKey: key,
  handleLocalRequest: workspaceSetup(
    services,
    new URL('../launcher', import.meta.url).pathname,
    {
      normalize: async (contents, context) => {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/desktop/normalize-raid-file`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${cron}`,
              'x-desktop-transport': key
            },
            body: JSON.stringify({ contents, context }),
            signal: AbortSignal.timeout(20000)
          }
        )
        assert.equal(
          response.status,
          200,
          'Canonical internal normalization succeeds'
        )
        return (await response.json()).rows
      }
    }
  )
})
gateway.setAppPort(port)
const request = (path, body, extra = {}) =>
  fetch(gateway.origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-desktop-transport': key,
      origin: gateway.origin,
      'content-type': 'application/json',
      ...extra
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
const evidence = { status: 'passed', checks: [] }
try {
  const application = services.launch(
    config.application.node,
    [join(config.application.directory, 'server.js')],
    {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
      NEXT_PUBLIC_SITE_URL: gateway.origin,
      SITE_URL: gateway.origin,
      NEXT_PUBLIC_SUPABASE_URL: gateway.origin + '/supabase',
      SUPABASE_URL: gateway.origin + '/supabase',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'desktop-public',
      SUPABASE_SERVICE_ROLE_KEY: services.serviceCredential,
      DESKTOP_TRANSPORT_KEY: key,
      CRON_SECRET: cron
    },
    config.application.directory
  )
  let ready = false
  for (let i = 0; i < 150; i++) {
    if (application.exitCode !== null || services.fault)
      throw new Error('Local application stopped')
    try {
      if ((await request('/api/health')).ok) {
        ready = true
        break
      }
    } catch {}
    await delay(100)
  }
  assert(ready, 'Actual standalone application is ready')
  assert.equal(
    (await request('/api/desktop/normalize-raid-file', { contents: 'unused' }))
      .status,
    401
  )
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-local-player',
          displayName: 'Synthetic Local Alias',
          guildName: 'Synthetic Local Guild'
        }
      })
    ).status,
    201
  )
  const record = JSON.parse(
    (
      await services.psql(
        "SELECT json_build_object('subject',subject_user_id,'mode',identity_mode,'guild',guild_code) FROM public.desktop_preview_setup;"
      )
    ).trim()
  )
  assert.equal(record.mode, 'local-file')
  assert.equal(record.guild, 'SYN-LOCAL')
  assert.equal(
    (
      await services.psql('SELECT auto_sync_enabled FROM public.guild_config;')
    ).trim(),
    'f'
  )
  assert.equal(
    (
      await services.psql(
        'SELECT source FROM public.player_identity_attestations;'
      )
    ).trim(),
    'desktop_local_claim'
  )
  assert.equal(
    (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '0'
  )
  evidence.checks.push(
    'empty local workspace records explicit local identity provenance, no sample raid data or upstream ownership claim'
  )
  const row = {
    userId: 'synthetic-local-player',
    username: 'Untrusted alias',
    type: 'SyntheticBoss',
    encounterIndex: 0,
    damageType: 'Battle',
    damageDealt: 250,
    remainingHp: 750,
    maxHp: 1000,
    rarity: 'Legendary',
    tier: 5,
    set: 1,
    startedOn: '2000-01-01T00:00:00.123Z',
    completedOn: '2000-01-01T00:00:10.987Z'
  }
  const file = {
    format: 'ta-raid-file-v1',
    guildCode: 'SYN-LOCAL',
    season: 9999,
    entries: [row]
  }
  const contents = JSON.stringify(file)
  const attempt = async (body, extra) => {
    await delay(3100)
    return request('/desktop/import', body, extra)
  }
  assert.equal(
    (await attempt({ password: randomBytes(24).toString('hex'), contents }))
      .status,
    401
  )
  assert.equal(
    (
      await attempt(
        { password, contents },
        { origin: 'https://example.invalid' }
      )
    ).status,
    403
  )
  assert.equal(
    (
      await attempt({
        password,
        contents: JSON.stringify({ ...file, guildCode: 'SYN-OTHER' })
      })
    ).status,
    400
  )
  assert.equal(
    (
      await attempt({
        password,
        contents: JSON.stringify({
          ...file,
          entries: [row, { ...row, startedOn: 'invalid' }]
        })
      })
    ).status,
    400
  )
  assert.equal(
    (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '0'
  )
  assert.equal(
    (
      await services.psql('SELECT count(*) FROM public.desktop_raid_imports;')
    ).trim(),
    '0'
  )
  evidence.checks.push(
    'wrong password, foreign origin, unrelated guild and malformed later entry make no raid or receipt writes'
  )
  const normalizedResponse = await request(
    '/api/desktop/normalize-raid-file',
    {
      contents,
      context: {
        guildCode: record.guild,
        playerMappings: [['synthetic-local-player', 'Synthetic Local Alias']],
        bossMappings: {},
        clusterCode: null,
        clusterId: null
      }
    },
    { authorization: `Bearer ${cron}` }
  )
  assert.equal(normalizedResponse.status, 200)
  const normalizedRows = (await normalizedResponse.json()).rows
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
  await assert.rejects(
    services.psql(`BEGIN;
      SELECT set_config('request.jwt.claims',${quote(JSON.stringify({ sub: record.subject }))},true);
      SELECT public.desktop_import_raid('${'1'.repeat(64)}',${quote(
        JSON.stringify([
          normalizedRows[0],
          { ...normalizedRows[0], Guild: 'SYN-OTHER' }
        ])
      )}::jsonb);
      COMMIT;`)
  )
  await assert.rejects(
    services.psql(`BEGIN;
      SELECT set_config('request.jwt.claims',${quote(JSON.stringify({ sub: randomUUID() }))},true);
      SELECT public.desktop_import_raid('${'2'.repeat(64)}',${quote(JSON.stringify(normalizedRows))}::jsonb);
      COMMIT;`)
  )
  assert.equal(
    (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '0'
  )
  assert.equal(
    (
      await services.psql('SELECT count(*) FROM public.desktop_raid_imports;')
    ).trim(),
    '0'
  )
  await assert.rejects(
    services.psql(
      'SET ROLE desktop_importer; SELECT "heroDetails" FROM public."EOT_GR_data";'
    )
  )
  evidence.checks.push(
    'database rejects a malformed later row and an unrelated subject atomically; import role cannot read raid payload columns; local setup disables automatic game sync'
  )
  const imported = await attempt({ password, contents })
  assert.equal(imported.status, 200, await imported.clone().text())
  assert.deepEqual(await imported.json(), {
    entries: 1,
    inserted: 1,
    repeated: false
  })
  const again = await attempt({ password, contents })
  assert.equal(again.status, 200)
  assert.deepEqual(await again.json(), {
    entries: 1,
    inserted: 0,
    repeated: true
  })
  const differentlyEncoded = await attempt({
    password,
    contents: JSON.stringify(file, null, 2)
  })
  assert.equal(differentlyEncoded.status, 200)
  assert.deepEqual(await differentlyEncoded.json(), {
    entries: 1,
    inserted: 0,
    repeated: false
  })
  const largestFile =
    contents + '\n'.repeat(8 * 1024 * 1024 - Buffer.byteLength(contents))
  assert.equal(Buffer.byteLength(largestFile), 8 * 1024 * 1024)
  const largestImport = await attempt({ password, contents: largestFile })
  assert.equal(largestImport.status, 200, await largestImport.clone().text())
  assert.deepEqual(await largestImport.json(), {
    entries: 1,
    inserted: 0,
    repeated: false
  })
  const observed = JSON.parse(
    (
      await services.psql(
        `SELECT json_build_object('count',count(*),'name',min("displayName"),'started',min("startedOn"),'damage',sum("damageDealt")) FROM public."EOT_GR_data";`
      )
    ).trim()
  )
  assert.equal(observed.count, 1)
  assert.equal(observed.name, 'Synthetic Local Alias')
  assert.equal(observed.damage, 250)
  assert.equal(Date.parse(observed.started), Date.parse('2000-01-01T00:00:00Z'))
  const receiptCount = (
    await services.psql('SELECT count(*) FROM public.desktop_raid_imports;')
  ).trim()
  assert.equal(receiptCount, '3')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await assert.rejects(
      services.psql(
        `SET ROLE ${role}; SELECT * FROM public.desktop_raid_imports;`
      )
    )
    await assert.rejects(
      services.psql(
        `SET ROLE ${role}; SELECT public.desktop_import_raid('${'0'.repeat(64)}','[]'::jsonb);`
      )
    )
  }
  evidence.checks.push(
    'actual compiled canonical transformer and scoped transaction import once, retries and alternate encodings do not duplicate records; root aliases and event precision preserved'
  )
  evidence.checks.push(
    'anonymous, authenticated and service roles cannot inspect receipts or execute the import primitive'
  )
  evidence.checks.push(
    'an exactly 8 MiB valid file survives JSON transport and actual Next.js proxy/body handling'
  )
} finally {
  await gateway.stop()
  await services.stop()
}
const reopened = await nativeServices({ ...config, state })
try {
  assert.equal(
    (await reopened.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '1'
  )
  assert.equal(
    (
      await reopened.psql('SELECT count(*) FROM public.desktop_raid_imports;')
    ).trim(),
    '3'
  )
  evidence.checks.push('native restart preserves imported data and receipts')
} finally {
  await reopened.stop()
}
evidence.scope =
  'Synthetic local file coordinator, actual compiled normalization endpoint and native services. Renderer and OS file chooser require separate proof; game integration and server-verified identity are not established.'
await writeFile(
  config.evidence.replace(/\.json$/, '-file-import.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
console.log(JSON.stringify(evidence, null, 2))
