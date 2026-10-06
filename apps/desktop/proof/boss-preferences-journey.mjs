import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'
import {
  initializeReferenceBosses,
  readReferenceBosses
} from '../launcher/reference-catalog.mjs'
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const state = join(
  config.stateRoot || config.state,
  'boss-preferences-' + randomUUID()
)
const directory = resolve('data/game-data')
const services = await nativeServices({ ...config, state })
const transport = randomBytes(32).toString('hex'),
  password = randomBytes(24).toString('hex')
const gateway = await loopbackGateway({
  services,
  transportKey: transport,
  handleLocalRequest: workspaceSetup(
    services,
    new URL('../launcher', import.meta.url).pathname
  )
})
const request = (
  path,
  body,
  extra = {},
  method = body === undefined ? 'GET' : 'POST'
) =>
  fetch(gateway.origin + path, {
    method,
    headers: {
      'x-desktop-transport': transport,
      origin: gateway.origin,
      apikey: 'desktop-public',
      'content-type': 'application/json',
      ...extra
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  })
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'"
let subject, expected, timestamp, catalogue
const checks = []
try {
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-boss-player',
          displayName: 'Synthetic Boss Alias',
          guildName: 'Synthetic Local Guild'
        }
      })
    ).status,
    201
  )
  catalogue = await readReferenceBosses(directory)
  assert.equal(catalogue.length, 48)
  await initializeReferenceBosses(services, directory)
  await services.psql(
    "UPDATE public.boss_mapping SET id=777 WHERE boss_type='Magnus' AND encounter_index=0;"
  )
  const ids = await services.psql(
    'SELECT id,boss_type,encounter_index FROM public.boss_mapping ORDER BY boss_type,encounter_index;'
  )
  await initializeReferenceBosses(services, directory)
  assert.equal(
    await services.psql(
      'SELECT id,boss_type,encounter_index FROM public.boss_mapping ORDER BY boss_type,encounter_index;'
    ),
    ids
  )
  await services.psql(
    "INSERT INTO public.boss_mapping(id,boss_type,encounter_index,boss_name) VALUES(778,'Magnus',0,'Synthetic Duplicate');"
  )
  await assert.rejects(initializeReferenceBosses(services, directory))
  await services.psql('DELETE FROM public.boss_mapping WHERE id=778;')
  assert.equal(
    await services.psql(
      'SELECT id,boss_type,encounter_index FROM public.boss_mapping ORDER BY boss_type,encounter_index;'
    ),
    ids
  )
  const login = await request('/supabase/auth/v1/token?grant_type=password', {
    email: 'desktop@localhost.invalid',
    password
  })
  assert.equal(login.status, 200)
  const session = await login.json()
  subject = session.user.id
  const foreign = randomUUID()
  await services.psql(
    `INSERT INTO auth.users(id,aud,role,email) VALUES(${quote(foreign)},'authenticated','authenticated','synthetic-foreign@example.invalid'); INSERT INTO public.player_mapping(id,user_id,player_id,display_name,guild_code,is_current,role) VALUES(999,${quote(foreign)},'synthetic-foreign-player','Synthetic Foreign Alias','SYN-LOCAL',true,'member');`
  )
  const auth = {
    authorization: `Bearer ${session.access_token}`,
    prefer: 'return=representation'
  }
  const path =
    '/supabase/rest/v1/current_user_player_mapping?user_id=eq.' +
    subject +
    '&is_current=eq.true&select=boss_preferences,preferences_updated_at'
  const update = (body, headers = auth, destination = path) =>
    request(destination, body, headers, 'PATCH')
  expected = { main_Magnus: 'preferred', side_ExaltedSorcerer: 'avoid' }
  const side = catalogue.find((e) => e.bossType === 'Magnus' && e.index === 1)
  expected = { main_Magnus: 'preferred', ['side_' + side.name]: 'avoid' }
  const saved = await update({ boss_preferences: expected })
  assert.equal(saved.status, 200)
  const first = (await saved.json())[0]
  assert.deepEqual(first.boss_preferences, expected)
  timestamp = first.preferences_updated_at
  assert(timestamp)
  assert.equal((await update({ boss_preferences: expected })).status, 200)
  assert.equal(
    (await (await request(path, undefined, auth)).json())[0]
      .preferences_updated_at,
    timestamp
  )
  assert.deepEqual(
    await (
      await update(
        { boss_preferences: expected },
        auth,
        path.replace(subject, foreign)
      )
    ).json(),
    []
  )
  for (const headers of [
    { prefer: 'return=representation' },
    {
      authorization: `Bearer ${services.token.service}`,
      prefer: 'return=representation'
    }
  ])
    assert(
      [401, 403].includes(
        (await update({ boss_preferences: expected }, headers)).status
      )
    )
  assert.equal(
    (
      await update(
        { boss_preferences: expected },
        auth,
        '/supabase/rest/v1/player_mapping?user_id=eq.' + subject
      )
    ).status,
    403
  )
  for (const protectedField of [
    { preferences_updated_at: '2000-01-01T00:00:00Z' },
    { role: 'leader' },
    { player_id: 'synthetic-replaced' }
  ])
    assert.equal((await update(protectedField)).status, 403)
  for (const value of [
    null,
    [],
    { main_Magnus: 'neutral' },
    { main_Magnus: 1 },
    { main_Magnus: { value: 'preferred' } },
    { synthetic_unknown: 'avoid' },
    { ['x'.repeat(17000)]: 'preferred' }
  ])
    assert.equal((await update({ boss_preferences: value })).status, 400)
  assert.deepEqual(
    (await (await request(path, undefined, auth)).json())[0],
    first
  )
  assert.equal((await update({ boss_preferences: {} })).status, 200)
  await services.psql(
    `ALTER TABLE public.player_mapping DISABLE TRIGGER desktop_boss_preferences_write; UPDATE public.player_mapping SET boss_preferences='{"synthetic_legacy":"old"}'::jsonb WHERE user_id=${quote(subject)}; ALTER TABLE public.player_mapping ENABLE TRIGGER desktop_boss_preferences_write;`
  )
  assert.equal(
    (await update({ last_active_at: '2000-01-01T00:00:00Z' })).status,
    200
  )
  assert.equal((await update({ boss_preferences: expected })).status, 200)
  timestamp = (await (await request(path, undefined, auth)).json())[0]
    .preferences_updated_at
  checks.push(
    '48 packaged boss encounters initialize without manual seeding and retain IDs on repeat refresh',
    'owner projection writes and server timestamps succeed; identical save preserves timestamp',
    'foreign, anonymous, service, base-table and protected-column writes refuse',
    'invalid types, choices, unknown keys and oversized objects roll back; clearing and legacy repair succeed'
  )
} finally {
  await gateway.stop()
  await services.stop()
}
const reopened = await nativeServices({ ...config, state })
try {
  const row = JSON.parse(
    (
      await reopened.psql(
        `SELECT json_build_object('preferences',boss_preferences,'timestamp',preferences_updated_at) FROM public.player_mapping WHERE user_id=${quote(subject)};`
      )
    ).trim()
  )
  assert.deepEqual(row.preferences, expected)
  assert.equal(Date.parse(row.timestamp), Date.parse(timestamp))
  assert.equal(
    (await reopened.psql('SELECT count(*) FROM public.boss_mapping;')).trim(),
    '48'
  )
  checks.push(
    'native restart retains boss preferences, timestamp and catalogue'
  )
} finally {
  await reopened.stop()
}
const evidence = {
  status: 'passed',
  checks,
  scope:
    'Synthetic native Auth/PostgREST owner writes and packaged reference catalogue; installed renderer acceptance is separate.'
}
await writeFile(
  config.evidence.replace(/\.json$/, '-boss-preferences.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
console.log(JSON.stringify(evidence, null, 2))
