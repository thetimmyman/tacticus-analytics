import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const state = join(
  config.stateRoot || config.state,
  'preferences-' + randomUUID()
)
const services = await nativeServices({ ...config, state })
const key = randomBytes(32).toString('hex'),
  password = randomBytes(24).toString('hex')
const gateway = await loopbackGateway({
  services,
  transportKey: key,
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
      'x-desktop-transport': key,
      origin: gateway.origin,
      apikey: 'desktop-public',
      'content-type': 'application/json',
      ...extra
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  })
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
let subject, expected
const checks = []
try {
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-preferences-player',
          displayName: 'Synthetic Preferences Alias',
          guildName: 'Synthetic Local Guild'
        }
      })
    ).status,
    201
  )
  const login = await request('/supabase/auth/v1/token?grant_type=password', {
    email: 'desktop@localhost.invalid',
    password
  })
  assert.equal(login.status, 200)
  const session = await login.json()
  subject = session.user.id
  const foreign = randomUUID()
  await services.psql(`INSERT INTO auth.users(id,aud,role,email) VALUES(${quote(foreign)},'authenticated','authenticated','synthetic-foreign@example.invalid');
    INSERT INTO public.player_mapping(id,user_id,player_id,display_name,guild_code,is_current,role) VALUES(999,${quote(foreign)},'synthetic-foreign-player','Synthetic Foreign Alias','SYN-LOCAL',true,'member');`)
  const auth = {
    authorization: `Bearer ${session.access_token}`,
    prefer: 'return=representation'
  }
  const fields =
    'timezone,discord_username,theme_preference,primary_team,secondary_team,tertiary_team'
  const path =
    '/supabase/rest/v1/current_user_player_mapping?user_id=eq.' +
    subject +
    '&is_current=eq.true&select=' +
    fields
  const update = (body, headers = auth, destination = path) =>
    request(destination, body, headers, 'PATCH')
  const catalogue = await request(
    '/supabase/rest/v1/meta_teams?select=team_name&order=sort_order',
    undefined,
    auth
  )
  assert.equal(catalogue.status, 200)
  assert.deepEqual(
    (await catalogue.json()).map((x) => x.team_name),
    [
      'Admech',
      'Battlesuits',
      'Custodes',
      'Double Howl',
      'Forcasmo',
      'Lavstodes',
      "Neuro / Z'Kar",
      'Orkz'
    ]
  )
  const selected = {
    timezone: 'America/Chicago',
    discord_username: 'Synthetic <img src=x onerror=synthetic>',
    theme_preference: 'light',
    primary_team: 'Admech',
    secondary_team: 'Battlesuits',
    tertiary_team: "Neuro / Z'Kar"
  }
  const saved = await update(selected)
  assert.equal(saved.status, 200, await saved.clone().text())
  assert.deepEqual(await saved.json(), [selected])
  const foreignUpdate = await update(
    { timezone: 'Asia/Tokyo' },
    auth,
    path.replace(subject, foreign)
  )
  assert.equal(foreignUpdate.status, 200)
  assert.deepEqual(await foreignUpdate.json(), [])
  assert.equal(
    (
      await services.psql(
        `SELECT timezone FROM public.player_mapping WHERE user_id=${quote(foreign)};`
      )
    ).trim(),
    'UTC'
  )
  for (const body of [
    { role: 'leader' },
    { user_id: foreign },
    { guild_code: 'SYN-FOREIGN' },
    { is_app_admin: true },
    { discord_user_id: 'synthetic-forbidden' }
  ])
    assert.equal((await update(body)).status, 403)
  assert.equal((await update({ timezone: 'UTC' }, {})).status, 401)
  assert.equal(
    (
      await update(
        { timezone: 'UTC' },
        { authorization: `Bearer ${services.serviceCredential}` }
      )
    ).status,
    403
  )
  assert.equal(
    (
      await request(
        '/supabase/rest/v1/player_mapping?user_id=eq.' + subject,
        { timezone: 'UTC' },
        auth,
        'PATCH'
      )
    ).status,
    403
  )
  for (const invalid of [
    { timezone: 'Synthetic/Unknown' },
    { discord_username: 'a'.repeat(129) },
    { discord_username: 'Synthetic\nAlias' },
    { theme_preference: 'invalid theme' },
    { theme_preference: 'a'.repeat(21) },
    { primary_team: 'Synthetic Unknown Team' },
    { secondary_team: 'Synthetic Unknown Team' },
    { tertiary_team: 'Synthetic Unknown Team' }
  ])
    assert.equal((await update(invalid)).status, 400)
  const retained = await request(path, undefined, auth)
  assert.deepEqual(await retained.json(), [selected])
  checks.push(
    'bundled canonical team names are available without manual seeding; current subject saves all six display preferences while foreign, anonymous, service and base-table writes stay denied'
  )
  checks.push(
    'protected identity, role and verified Discord columns remain unwritable; invalid timezone, alias, theme and team writes leave the previous preferences intact'
  )
  await services.psql(
    `ALTER TABLE public.player_mapping DISABLE TRIGGER desktop_profile_preferences_write; UPDATE public.player_mapping SET timezone='Synthetic/Legacy',primary_team='Synthetic Legacy Team',theme_preference='legacy theme' WHERE user_id=${quote(subject)}; ALTER TABLE public.player_mapping ENABLE TRIGGER desktop_profile_preferences_write;`
  )
  assert.equal(
    (await update({ last_active_at: '2000-01-01T00:00:00Z' })).status,
    200
  )
  assert.equal((await update({ timezone: 'UTC' })).status, 200)
  const cleared = {
    timezone: null,
    discord_username: null,
    theme_preference: null,
    primary_team: null,
    secondary_team: null,
    tertiary_team: null
  }
  const clear = await update(cleared)
  assert.equal(clear.status, 200)
  assert.deepEqual(await clear.json(), [cleared])
  expected = {
    ...selected,
    timezone: 'UTC',
    theme_preference: 'dark',
    discord_username: null
  }
  assert.equal((await update(expected)).status, 200)
  checks.push(
    'legacy preferences permit unrelated activity and individual repairs; optional fields can be cleared and replaced atomically'
  )
} finally {
  await gateway.stop()
  await services.stop()
}
const reopened = await nativeServices({ ...config, state })
try {
  const value = JSON.parse(
    (
      await reopened.psql(
        `SELECT json_build_object('timezone',timezone,'discord_username',discord_username,'theme_preference',theme_preference,'primary_team',primary_team,'secondary_team',secondary_team,'tertiary_team',tertiary_team) FROM public.player_mapping WHERE user_id=${quote(subject)};`
      )
    ).trim()
  )
  assert.deepEqual(value, expected)
  assert.equal(
    (await reopened.psql('SELECT count(*) FROM public.meta_teams;')).trim(),
    '8'
  )
  checks.push(
    'native restart preserves owner preferences and stable team catalogue'
  )
} finally {
  await reopened.stop()
}
const evidence = {
  status: 'passed',
  checks,
  scope:
    'Synthetic native Auth/PostgREST and canonical owner projection; compiled form and ordinary installed GUI are separate acceptance checks.'
}
await writeFile(
  config.evidence.replace(/\.json$/, '-preferences.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
console.log(JSON.stringify(evidence, null, 2))
