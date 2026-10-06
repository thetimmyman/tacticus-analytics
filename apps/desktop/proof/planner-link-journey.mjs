import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const state = join(config.stateRoot || config.state, 'planner-' + randomUUID())
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
    body: body === undefined ? undefined : JSON.stringify(body)
  })
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const checks = []
let subject
try {
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-planner-player',
          displayName: 'Synthetic Planner Alias',
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
  const path =
    '/supabase/rest/v1/current_user_player_mapping?user_id=eq.' +
    subject +
    '&is_current=eq.true&select=user_id,tacticus_share_url'
  const update = (body, headers = auth, destination = path) =>
    request(destination, body, headers, 'PATCH')
  const saved = await update({
    tacticus_share_url: 'https://example.invalid/synthetic-planner?view=roster'
  })
  assert.equal(saved.status, 200, await saved.clone().text())
  const result = await saved.json()
  assert.equal(result.length, 1)
  assert.equal(result[0].user_id, subject)
  assert.equal(
    result[0].tacticus_share_url,
    'https://example.invalid/synthetic-planner?view=roster'
  )
  const foreignUpdate = await update(
    { tacticus_share_url: 'https://example.invalid/foreign' },
    auth,
    path.replace(subject, foreign)
  )
  assert.equal(foreignUpdate.status, 200)
  assert.deepEqual(await foreignUpdate.json(), [])
  assert.equal(
    (
      await services.psql(
        `SELECT tacticus_share_url IS NULL FROM public.player_mapping WHERE user_id=${quote(foreign)};`
      )
    ).trim(),
    't'
  )
  for (const body of [{ role: 'leader' }, { user_id: foreign }])
    assert.equal((await update(body)).status, 403)
  const hiddenKey = await update({
    tacticus_api_key_encrypted: 'synthetic-forbidden'
  })
  assert.equal(hiddenKey.status, 400)
  assert.equal((await hiddenKey.json()).code, 'PGRST204')

  assert.equal(
    (
      await update(
        { tacticus_share_url: 'https://example.invalid/anonymous' },
        {}
      )
    ).status,
    401
  )
  assert.equal(
    (
      await update(
        { tacticus_share_url: 'https://example.invalid/service' },
        { authorization: `Bearer ${services.serviceCredential}` }
      )
    ).status,
    403
  )
  for (const value of [
    'javascript:alert(1)',
    'https://synthetic-user:synthetic-pass@example.invalid/',
    'https://example.invalid/\ninvalid',
    'https://example.invalid/' + 'a'.repeat(2048),
    'https:///missing-host'
  ])
    assert.equal((await update({ tacticus_share_url: value })).status, 400)
  assert.equal(
    (
      await services.psql(
        `SELECT tacticus_share_url FROM public.player_mapping WHERE user_id=${quote(subject)};`
      )
    ).trim(),
    result[0].tacticus_share_url
  )
  checks.push(
    'actual native Auth and PostgREST permit only the current subject planner-link column; foreign filters update zero rows and protected identity/role/key columns stay denied'
  )
  checks.push(
    'anonymous and service writes are denied; unsafe protocols, credentialed authority, controls, missing hosts and oversized links preserve the original value'
  )
  // Historical values can be repaired without blocking activity or roster updates.
  await services.psql(
    `ALTER TABLE public.player_mapping DISABLE TRIGGER desktop_planner_link_write; UPDATE public.player_mapping SET tacticus_share_url='javascript:synthetic-legacy' WHERE user_id=${quote(subject)}; ALTER TABLE public.player_mapping ENABLE TRIGGER desktop_planner_link_write;`
  )
  assert.equal(
    (await update({ last_active_at: '2000-01-01T00:00:00Z' })).status,
    200
  )
  assert.equal(
    (
      await services.psql(
        `SELECT tacticus_share_url FROM public.player_mapping WHERE user_id=${quote(subject)};`
      )
    ).trim(),
    'javascript:synthetic-legacy'
  )
  checks.push(
    'unrelated activity updates preserve legacy links; clearing the link repairs the legacy value'
  )
  assert.equal((await update({ tacticus_share_url: null })).status, 200)
  assert.equal(
    (
      await services.psql(
        `SELECT tacticus_share_url IS NULL FROM public.player_mapping WHERE user_id=${quote(subject)};`
      )
    ).trim(),
    't'
  )
  assert.equal(
    (
      await update({
        tacticus_share_url: 'https://example.invalid/saved-planner'
      })
    ).status,
    200
  )
  checks.push(
    'the native profile projection supports clearing and replacing the local link'
  )
} finally {
  await gateway.stop()
  await services.stop()
}
const reopened = await nativeServices({ ...config, state })
try {
  assert.equal(
    (
      await reopened.psql(
        `SELECT tacticus_share_url FROM public.player_mapping WHERE user_id=${quote(subject)};`
      )
    ).trim(),
    'https://example.invalid/saved-planner'
  )
  checks.push('native restart preserves the saved local planner link')
} finally {
  await reopened.stop()
}
const evidence = {
  status: 'passed',
  checks,
  scope:
    'Synthetic native Auth/PostgREST and canonical owner-view writes; installed form acceptance and external browser navigation remain separate.'
}
await writeFile(
  config.evidence.replace(/\.json$/, '-planner.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
console.log(JSON.stringify(evidence, null, 2))
