import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  syntheticRaidFixture,
  importSyntheticRaid
} from '../../proof/synthetic-import.mjs'

// Explicit installed test fixture only. Never reached during ordinary startup.
export async function seedFormerPasswordFixture(services) {
  const occupied = (
    await services.psql(
      'SELECT EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.desktop_preview_setup) OR EXISTS(SELECT 1 FROM public.player_mapping);'
    )
  ).trim()
  if (occupied !== 'f')
    throw new Error('Migration fixture requires a new empty test workspace')
  const response = await fetch(
    `http://127.0.0.1:${services.ports.auth}/admin/users`,
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${services.token.service}`
      },
      body: JSON.stringify({
        email: 'desktop@localhost.invalid',
        password: 'synthetic-former-workspace-password',
        email_confirm: true
      })
    }
  )
  if (!response.ok) throw new Error('Migration fixture local account failed')
  const account = await response.json()
  if (!/^[a-f0-9-]{36}$/.test(account.id))
    throw new Error('Invalid fixture owner')
  await importSyntheticRaid(services, syntheticRaidFixture(account.id), {
    recordSetup: true
  })
  await writeFile(
    join(services.state, 'workspace-owner.json'),
    JSON.stringify({ subject: account.id, kind: 'personal-holding' }),
    { flag: 'wx', flush: true }
  )
  return account.id
}
