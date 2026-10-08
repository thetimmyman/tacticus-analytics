import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import {
  syntheticRaidFixture,
  importSyntheticRaid
} from '../../proof/synthetic-import.mjs'
import { deviceSessionBootstrap } from './device-session.mjs'
import { windowsOnboarding } from './onboarding.mjs'
import { nativeCommand } from './native-command.mjs'
import { randomUUID } from 'node:crypto'
import { workspaceGate } from './session-gate.mjs'
import { holdCredentialSurface } from './credential-surface.mjs'
import { personalExport } from './export.mjs'
import { personalImport } from './import.mjs'

export function windowsSetup(services, assets, launcherAssets, session) {
  const ownerFile = join(services.state, 'workspace-owner.json')
  const readOwner = async () => {
    try {
      const subject = JSON.parse(await readFile(ownerFile, 'utf8')).subject
      if (!/^[a-f0-9-]{36}$/.test(subject))
        throw new Error('Local owner binding is unavailable')
      return subject
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const subject = (
      await services.psql(
        'SELECT subject_user_id FROM public.desktop_preview_setup LIMIT 1;'
      )
    ).trim()
    return /^[a-f0-9-]{36}$/.test(subject) ? subject : null
  }
  const gate = workspaceGate({ services, ...session, owner: readOwner })
  const onboarding = windowsOnboarding(
    services.state,
    nativeCommand,
    gate.assertCurrent
  )
  const open = deviceSessionBootstrap({
    services,
    capability: session.brokerToken,
    readOwner,
    async writeOwner(subject) {
      const existing = await readOwner()
      if (existing && existing !== subject) throw new Error('Owner mismatch')
      if (existing) return
      const temporary = `${ownerFile}.${randomUUID()}.tmp`
      await writeFile(
        temporary,
        JSON.stringify({ subject, kind: 'personal-holding' }),
        { flag: 'wx', flush: true }
      )
      await rename(temporary, ownerFile)
    }
  })
  const exportPersonal = personalExport({
    native: nativeCommand,
    gate,
    view: () => onboarding.view()
  })
  const importPersonal = personalImport({
    native: nativeCommand,
    gate,
    onboarding
  })
  // Protected operations run one at a time. The page's state read waits its
  // turn; a second change while one is running is refused.
  let queue = Promise.resolve()
  let changing = false
  return async (req, res, url) => {
    if (holdCredentialSurface(req, res, url)) return true
    const json = (code, value) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      res.end(JSON.stringify(value))
    }
    if (req.method === 'GET' && url.pathname === '/desktop/setup') {
      res.writeHead(200, {
        'content-type': 'text/html',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      })
      res.end(await readFile(join(assets, 'setup.html')))
      return true
    }
    if (
      req.method === 'GET' &&
      ['/desktop/windows-setup.js', '/desktop/windows-style.css'].includes(
        url.pathname
      )
    ) {
      res.writeHead(200, {
        'content-type': url.pathname.endsWith('.js')
          ? 'text/javascript'
          : 'text/css'
      })
      res.end(await readFile(join(assets, url.pathname.split('/').at(-1))))
      return true
    }
    if (await open(req, res, url)) return true
    const protectedOperation =
      url.pathname === '/desktop/official-state' ||
      url.pathname === '/desktop/demo-setup' ||
      [
        '/desktop/export-personal',
        '/desktop/import-personal',
        '/desktop/connect-official',
        '/desktop/skip-optional'
      ].includes(url.pathname) ||
      url.pathname.startsWith('/desktop/disconnect/')
    if (protectedOperation) {
      const change = url.pathname !== '/desktop/official-state'
      if (change && changing) {
        json(409, { error: 'Setup is already running' })
        return true
      }
      if (change) changing = true
      const previous = queue
      let release
      queue = new Promise((accept) => (release = accept))
      try {
        await previous
        return await gate.run(async () => {
          await onboarding.recoverPending()
          return official(req, res, url, json)
        })
      } catch (error) {
        if (res.headersSent) return true
        json(error.code === 'ESESSION' ? 401 : 503, {
          error:
            error.code === 'ESESSION'
              ? error.message
              : 'Local authorization service is unavailable.',
          code: error.code === 'ESESSION' ? 'ESESSION' : 'EAUTH'
        })
        return true
      } finally {
        if (change) changing = false
        release()
      }
    }
    if (url.pathname.startsWith('/desktop/')) {
      json(404, { error: 'Not found' })
      return true
    }
    return false
  }
  async function official(req, res, url, json) {
    if (req.method === 'POST' && url.pathname === '/desktop/demo-setup') {
      let text = ''
      for await (const chunk of req) {
        text += chunk
        if (text.length > 2048) {
          json(413, { error: 'Request limit' })
          return true
        }
      }
      let input
      try {
        input = JSON.parse(text)
      } catch {
        json(400, { error: 'Invalid demo request' })
        return true
      }
      if (
        !input ||
        Object.keys(input).some((key) => key !== 'sample') ||
        input.sample !== true
      ) {
        json(400, { error: 'Confirm the synthetic sample.' })
        return true
      }
      const initialized =
        (
          await services.psql(
            'SELECT EXISTS(SELECT 1 FROM public.desktop_preview_setup);'
          )
        ).trim() === 't'
      if (!initialized) {
        const state = onboarding.state.read()
        const occupied =
          (
            await services.psql(
              'SELECT EXISTS(SELECT 1 FROM public.player_mapping) OR EXISTS(SELECT 1 FROM public.guild_config) OR EXISTS(SELECT 1 FROM public."EOT_GR_data");'
            )
          ).trim() === 't'
        if (
          occupied ||
          state.personal ||
          Object.keys(state.vaultReferences ?? {}).length
        ) {
          json(409, {
            error: 'Retained personal data cannot be replaced by the demo.'
          })
          return true
        }
        const subject = await readOwner()
        gate.assertCurrent()
        await importSyntheticRaid(services, syntheticRaidFixture(subject), {
          recordSetup: true
        })
        gate.assertCurrent()
      }
      json(200, { destination: '/player-performance?guild=SYN001&season=9999' })
      return true
    }
    if (req.method === 'GET' && url.pathname === '/desktop/official-state') {
      json(200, onboarding.view())
      return true
    }
    if (req.method === 'POST' && url.pathname === '/desktop/export-personal') {
      try {
        const exported = await exportPersonal()
        json(200, exported)
      } catch (error) {
        if (error.code === 'ESESSION') throw error
        json(503, {
          error: 'Native file choice or protected export is unavailable.'
        })
      }
      return true
    }
    if (req.method === 'POST' && url.pathname === '/desktop/import-personal') {
      try {
        await importPersonal()
        json(200, onboarding.view())
      } catch (error) {
        if (error.code === 'ESESSION') throw error
        json(409, {
          error:
            'Import needs an empty workspace and a supported secret-free local projection.'
        })
      }
      return true
    }
    if (req.method === 'POST' && url.pathname === '/desktop/connect-official') {
      try {
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 2048) throw new Error('Request limit')
          chunks.push(chunk)
        }
        const input = size
          ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
          : {}
        if (
          !input ||
          typeof input !== 'object' ||
          Object.keys(input).some(
            (key) => !['requested', 'reuse'].includes(key)
          )
        )
          throw new Error('Unsupported request')
        const requested = input.requested ?? ['Player', 'Guild', 'Guild Raid']
        if (
          !Array.isArray(requested) ||
          requested.length > 3 ||
          requested.some(
            (scope) => !['Player', 'Guild', 'Guild Raid'].includes(scope)
          )
        )
          throw new Error('Unsupported capability')
        const stored = onboarding.state.read()
        const reuseHandle =
          input.reuse === true ? stored.vaultReferences?.Player : undefined
        if (input.reuse === true && !reuseHandle)
          throw new Error('Existing official connection unavailable')
        // Native prompt conveys consent; native confirmation is a separate fixed operation.
        const view = await onboarding.connect({
          requested,
          reuseHandle,
          expectedGuildId: stored.guildId,
          confirmPlayer: async ({ displayName }) =>
            (await nativeCommand(['confirm-player', displayName])).confirmed
        })
        json(200, view)
      } catch (error) {
        if (error.code === 'ESESSION') throw error
        json(503, {
          error:
            error.code === 'EVAULTLOCKED'
              ? 'Windows secure input or vault is unavailable. Unlock the Windows vault and retry.'
              : error.code === 'EUPSTREAM'
                ? 'Official access is invalid or expired. Replace the official key or retry later.'
                : 'Official access is unavailable. Retained data can be read offline when the workspace reopens.'
        })
      }
      return true
    }
    if (
      req.method === 'POST' &&
      url.pathname.startsWith('/desktop/disconnect/')
    ) {
      const scope = { player: 'Player', guild: 'Guild', raid: 'Guild Raid' }[
        url.pathname.split('/').at(-1)
      ]
      if (!scope) {
        json(400, { error: 'Unsupported capability' })
        return true
      }
      try {
        json(200, await onboarding.disconnect(scope))
      } catch {
        json(503, {
          error: 'Vault removal is unavailable. Retained data remains local.'
        })
      }
      return true
    }
    if (req.method === 'POST' && url.pathname === '/desktop/skip-optional') {
      try {
        json(200, await onboarding.skipOptional())
      } catch {
        json(409, { error: 'Player access is required' })
      }
      return true
    }
    json(405, { error: 'Unsupported operation' })
    return true
  }
}
