import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { workspaceRecovery } from './recovery.mjs'
import { workspaceRaidImport } from './raid-import.mjs'
import { workspaceGameConnection } from './game-connection.mjs'
import { workspaceRosterImport } from './roster-import.mjs'
import { localIdentity, createLocalWorkspace } from './local-workspace.mjs'
import { loadScopedConnections } from './scoped-connections.mjs'
import {
  syntheticRaidFixture,
  importSyntheticRaid
} from '../proof/synthetic-import.mjs'

const email = 'desktop@localhost.invalid'
export function workspaceSetup(services, assets, options = {}) {
  const raidImport = workspaceRaidImport(services, options)
  const gameConnection = workspaceGameConnection(services, options)
  const rosterImport = workspaceRosterImport(services, options)
  const recovery = workspaceRecovery(services)
  let busy = false
  const initialized = async () =>
    (
      await services.psql(
        'SELECT EXISTS (SELECT 1 FROM public.desktop_preview_setup);'
      )
    ).trim() === 't'
  const respond = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    res.end(JSON.stringify(body))
  }
  return async (req, res, url) => {
    if (await gameConnection(req, res, url)) return true
    if (await recovery(req, res, url)) return true
    if (await rosterImport(req, res, url)) return true
    if (await raidImport(req, res, url)) return true
    if (req.method === 'GET' && url.pathname === '/desktop/onboarding-status') {
      const owner = JSON.parse(
        (
          await services.psql(
            `SELECT coalesce((SELECT json_build_object('installation',s.subject_user_id,'guildCode',s.guild_code,'demo',s.identity_mode='sample','playerReady',p.api_key_last_verified IS NOT NULL,'tokens',p.last_sync_tokens,'bombs',p.last_sync_bombs,'updatedAt',p.last_sync_at AT TIME ZONE 'UTC','verifiedAt',p.api_key_last_verified,'season',(SELECT max(e.season_num) FROM public."EOT_GR_data" e WHERE e."Guild"=s.guild_code)) FROM public.desktop_preview_setup s JOIN public.player_mapping p ON p.user_id=s.subject_user_id AND p.is_current AND p.guild_code=s.guild_code WHERE s.singleton),'null'::json);`
          )
        ).trim()
      )
      let saved
      try {
        saved = await loadScopedConnections(services.state)
      } catch {
        saved = null
      }
      const bound =
        saved &&
        owner &&
        saved.installation === owner.installation &&
        saved.guildCode === owner.guildCode
      const roles = Object.fromEntries(
        ['Player', 'Guild', 'Guild Raid'].map((scope) => {
          const role = bound ? saved.roles[scope] : null
          return [
            scope,
            {
              saved: Boolean(role),
              verifiedAt: role?.verifiedAt ?? null,
              expired: role?.expiresAt != null && role.expiresAt <= Date.now()
            }
          ]
        })
      )
      const guildReady =
        bound &&
        Boolean(saved.roles.Guild && saved.roles['Guild Raid']) &&
        saved.roles.Guild.guildId === saved.roles['Guild Raid'].guildId
      // Cached data remains readable offline; saved access must be rechecked for sync.
      const { installation: _installation, ...visible } = owner ?? {}
      respond(res, 200, { ...visible, roles, guildReady: Boolean(guildReady) })
      return true
    }
    if (req.method === 'GET' && url.pathname === '/desktop/workspace-info') {
      const info = JSON.parse(
        (
          await services.psql(
            `SELECT coalesce((SELECT json_build_object('guildCode',s.guild_code,'identityMode',s.identity_mode,'season',(SELECT max(e.season_num) FROM public."EOT_GR_data" e WHERE e."Guild"=s.guild_code)) FROM public.desktop_preview_setup s WHERE s.singleton),'null'::json);`
          )
        ).trim()
      )
      respond(res, 200, info)
      return true
    }
    if (req.method === 'GET' && url.pathname === '/desktop/connection-help')
      return false
    if (!url.pathname.startsWith('/desktop/')) return false
    if (
      req.method === 'GET' &&
      [
        '/desktop/setup',
        '/desktop/setup.js',
        '/desktop/connect',
        '/desktop/connect.js',
        '/desktop/style.css',
        '/desktop/import',
        '/desktop/import.js',
        '/desktop/raid-file-validation.mjs'
      ].includes(url.pathname)
    ) {
      const file =
        url.pathname === '/desktop/setup'
          ? 'setup.html'
          : url.pathname === '/desktop/connect'
            ? 'connect.html'
            : url.pathname === '/desktop/import'
              ? 'import.html'
              : url.pathname.slice('/desktop/'.length)
      let content = await readFile(join(assets, file), 'utf8')
      if (file === 'setup.html')
        content = content.replaceAll(
          'SETUP_MODE',
          (await initialized()) ? 'unlock' : 'create'
        )
      res.writeHead(200, {
        'content-type':
          file.endsWith('.js') || file.endsWith('.mjs')
            ? 'text/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : 'text/html',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      })
      res.end(content)
      return true
    }
    if (req.method !== 'POST' || url.pathname !== '/desktop/setup') {
      respond(res, 404, { error: 'Not found' })
      return true
    }
    if (busy || (await initialized())) {
      respond(res, 409, {
        error: 'A workspace already exists or setup is in progress.'
      })
      return true
    }
    busy = true
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 16384) {
          respond(res, 413, { error: 'Request is too large.' })
          return true
        }
        chunks.push(chunk)
      }
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        respond(res, 400, { error: 'Invalid setup request.' })
        return true
      }
      if (
        !input ||
        typeof input !== 'object' ||
        Object.keys(input).some(
          (key) => !['password', 'sample', 'identity'].includes(key)
        ) ||
        typeof input.password !== 'string' ||
        input.password.length < 12 ||
        input.password.length > 128 ||
        (input.sample !== true && input.sample !== false)
      ) {
        respond(res, 400, {
          error:
            'Use a password of 12–128 characters and choose a workspace type.'
        })
        return true
      }
      let identity
      if (input.sample === false) {
        try {
          identity = localIdentity(input.identity)
        } catch (error) {
          respond(res, 400, { error: error.message })
          return true
        }
      }
      const existing = JSON.parse(
        (
          await services.psql(`SELECT json_build_object(
        'account', EXISTS (SELECT 1 FROM auth.users WHERE email='desktop@localhost.invalid'),
        'occupied', EXISTS (SELECT 1 FROM public.player_mapping) OR EXISTS (SELECT 1 FROM public.guild_config) OR EXISTS (SELECT 1 FROM public."EOT_GR_data")
      );`)
        ).trim()
      )
      if (existing.occupied)
        throw new Error(
          'Incomplete workspace has unexpected data; refusing replacement'
        )
      const response = await fetch(
        `http://127.0.0.1:${services.ports.auth}/${existing.account ? 'token?grant_type=password' : 'admin/users'}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${services.token.service}`
          },
          body: JSON.stringify({
            email,
            password: input.password,
            email_confirm: true
          }),
          signal: AbortSignal.timeout(10000)
        }
      )
      if (!response.ok) {
        if (existing.account) {
          respond(res, 401, {
            error:
              'Use the original workspace password to resume interrupted setup.'
          })
          return true
        }
        throw new Error('Local account creation failed')
      }
      const account = await response.json()
      const subject = existing.account ? account.user.id : account.id
      if (input.sample === true)
        await importSyntheticRaid(services, syntheticRaidFixture(subject), {
          recordSetup: true
        })
      else await createLocalWorkspace(services, subject, identity)
      respond(res, 201, { email })
      return true
    } finally {
      busy = false
    }
  }
}
