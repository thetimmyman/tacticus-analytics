import { createHash } from 'node:crypto'
import {
  syntheticRaidFixture,
  importSyntheticRaid
} from '../../proof/synthetic-import.mjs'

export const syntheticDigestScope =
  'persistent-business-data-excluding-activity-timestamps'

export function syntheticSnapshotDigest(database, personal) {
  const stable = structuredClone(database)
  // The ordinary page activity endpoint updates these fields on every view.
  // All business, membership, owner and attestation fields remain measured.
  for (const row of stable.mapping ?? []) {
    delete row.last_active_at
    delete row.updated_at
  }
  for (const row of stable.guilds ?? []) delete row.updated_at
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])])
      )
    return value
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical({ database: stable, personal })))
    .digest('hex')
}

export async function syntheticWorkspaceDigest(services, personal) {
  const database = JSON.parse(
    await services.psql(`SELECT jsonb_build_object(
      'subject',(SELECT subject_user_id FROM public.desktop_preview_setup WHERE singleton),
      'rows',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public."EOT_GR_data" t),
      'mapping',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.player_mapping t),
      'guilds',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.guild_config t),
      'attestations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.player_identity_attestations t)
    );`)
  )
  return syntheticSnapshotDigest(database, personal.state.read())
}

// This runs only in the disposable installed qualification workspace, against
// bundled PostgreSQL and Auth. It grants no live official API capability.
export async function qualifyDeviceSession({
  services,
  gateway,
  transportKey,
  brokerToken,
  gate,
  personal
}) {
  const initialized =
    (
      await services.psql(
        'SELECT EXISTS(SELECT 1 FROM public.desktop_preview_setup);'
      )
    ).trim() === 't'
  const headers = {
    origin: gateway.origin,
    'x-desktop-transport': transportKey,
    'content-type': 'application/json'
  }
  if (!initialized) {
    const created = await fetch(gateway.origin + '/desktop/setup', {
      method: 'POST',
      headers,
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    })
    const holding = await created.json()
    if (
      !created.ok ||
      holding.status !== 'player-required' ||
      personal.view().personal
    )
      throw new Error('Fresh personal holding workspace did not initialize')
  }
  const subject = (
    await services.psql(
      'SELECT subject_user_id FROM public.desktop_preview_setup WHERE singleton;'
    )
  ).trim()
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subject))
    throw new Error('Synthetic owner was not initialized')
  if (!initialized)
    await importSyntheticRaid(services, syntheticRaidFixture(subject))
  const snapshot = () => syntheticWorkspaceDigest(services, personal)
  const before = await snapshot()
  // A renderer possesses the ordinary transport header, never the bootstrap
  // capability. Neither an absent transport nor renderer-only access can open.
  for (const supplied of [{}, headers]) {
    const refused = await fetch(gateway.origin + '/desktop/open', {
      method: 'POST',
      headers: supplied,
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    })
    if (refused.status !== 403)
      throw new Error('Unprivileged session bootstrap was not refused')
  }
  if (!initialized) {
    // Reproduce a former password-protected account without asking for or
    // retaining a password. The following native bootstrap must preserve it.
    const legacy = await fetch(
      `http://127.0.0.1:${services.ports.auth}/admin/users/${subject}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${services.token.service}`
        },
        body: JSON.stringify({
          password: 'Synthetic former workspace password 27!'
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      }
    )
    if (!legacy.ok) throw new Error('Synthetic migration prerequisite failed')
  }
  const opened = await fetch(gateway.origin + '/desktop/open', {
    method: 'POST',
    headers: { ...headers, 'x-desktop-broker': brokerToken },
    redirect: 'error',
    signal: AbortSignal.timeout(30000)
  })
  if (!opened.ok) throw new Error('Native automatic owner bootstrap failed')
  const { session } = await opened.json()
  const authorized = await gate.authorize(session?.access_token)
  authorized.assert()
  let forgedRefused = false
  try {
    await gate.authorize('synthetic.payload.signature')
  } catch (error) {
    forgedRefused = error.code === 'ESESSION'
  }
  if (!forgedRefused || before !== (await snapshot()))
    throw new Error('Automatic session did not preserve and verify its owner')
  return {
    synthetic: true,
    realBundledAuth: true,
    freshPasswordFreeHolding: !initialized,
    formerPasswordOwnerPreserved: !initialized,
    nativeAutomaticSession: true,
    transportOnlyBootstrapRefused: true,
    externalBootstrapRefused: true,
    forgedSessionRefused: true,
    localDataPreserved: true,
    syntheticDataDigest: before,
    syntheticDataDigestScope: syntheticDigestScope,
    keychainBindings: 'unqualified-owner-provisioning-required'
  }
}
