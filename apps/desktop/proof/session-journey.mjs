import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createServerClient } from '@supabase/ssr'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import {
  importSyntheticRaid,
  syntheticRaidFixture
} from './synthetic-import.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const local = {
  ...config,
  state: `${config.state}-sessions`,
  userSessionLifetimeSeconds: 3
}
let services, gateway
const jar = new Map()
const checks = []
async function start() {
  services = await nativeServices(local)
  const transportKey = randomBytes(32).toString('hex')
  gateway = await loopbackGateway({ services, transportKey })
  const request = (url, init) =>
    fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        'x-desktop-transport': transportKey
      }
    })
  const client = (key = 'desktop-public') =>
    createServerClient(`${gateway.origin}/supabase`, key, {
      global: { fetch: request },
      auth: { storageKey: 'tacticus-auth-token' },
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) =>
          cookies.forEach(({ name, value }) => {
            if (value) jar.set(name, value)
            else jar.delete(name)
          })
      }
    })
  return { client, request }
}
async function verify(client, subject) {
  const user = client()
  const identity = await user.auth.getUser()
  assert.equal(identity.error, null)
  assert.equal(identity.data.user.id, subject)
  const rows = await user.from('EOT_GR_data').select('id, Guild')
  assert.equal(rows.error, null)
  assert.equal(rows.data.length, 7)
  assert.ok(rows.data.every((row) => row.Guild !== 'SYN003'))
  const denied = await user.rpc('resolve_verified_players', {
    p_user_ids: [subject]
  })
  assert.ok(denied.error, 'Renewal must not grant service authority')
  return (await user.auth.getSession()).data.session
}
try {
  let { client, request } = await start()
  const password = randomBytes(24).toString('hex')
  const created = await client(
    services.serviceCredential
  ).auth.admin.createUser({
    email: 'synthetic-session@example.invalid',
    password,
    email_confirm: true
  })
  assert.equal(created.error, null)
  const subject = created.data.user.id
  await importSyntheticRaid(services, syntheticRaidFixture(subject))
  const signedIn = await client().auth.signInWithPassword({
    email: 'synthetic-session@example.invalid',
    password
  })
  assert.equal(signedIn.error, null)
  let session = signedIn.data.session
  assert.ok(session.expires_at * 1000 <= Date.now() + 4000)
  const expiredToken = session.access_token
  // PostgREST allows 30 seconds of clock skew beyond exp.
  await delay(Math.max(0, session.expires_at * 1000 + 32000 - Date.now()))
  const expired = await request(
    `${gateway.origin}/supabase/rest/v1/EOT_GR_data?select=id`,
    {
      headers: { Authorization: `Bearer ${expiredToken}` }
    }
  )
  assert.equal(expired.status, 401)
  checks.push('expired user JWT rejected by native PostgREST')
  session = await verify(client, subject)
  assert.notEqual(session.access_token, expiredToken)
  checks.push('SSR cookie session renewed by native Auth with RLS preserved')
  const beforeRestart = session.access_token
  const savedCookies = JSON.stringify([...jar])
  await gateway.stop()
  gateway = undefined
  await services.stop()
  services = undefined
  await delay(5000)
  jar.clear()
  for (const [name, value] of JSON.parse(savedCookies)) jar.set(name, value)
  ;({ client } = await start())
  session = await verify(client, subject)
  assert.notEqual(session.access_token, beforeRestart)
  checks.push(
    'expired cookie session renewed after native service restart without password'
  )
  const evidence = {
    status: 'passed',
    userSessionLifetimeSeconds: 3,
    checks,
    scope:
      'Native Auth/PostgREST and application SSR cookie client; renderer sleep/wake remains separate'
  }
  if (config.evidence)
    await writeFile(
      config.evidence.replace(/\.json$/, '-sessions.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await gateway?.stop()
  await services?.stop()
}
