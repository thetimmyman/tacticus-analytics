import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { workspaceSetup } from '../../launcher/workspace.mjs'
import { windowsOnboarding } from './onboarding.mjs'
import { nativeCommand } from './native-command.mjs'
import { randomUUID } from 'node:crypto'
import { workspaceGate } from './session-gate.mjs'
import { holdCredentialSurface } from './credential-surface.mjs'
import { personalExport } from './export.mjs'

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
  const synthetic = workspaceSetup(services, launcherAssets)
  const exportPersonal = personalExport({
    native: nativeCommand,
    gate,
    view: () => onboarding.view()
  })
  let confirming = false
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
    if (req.method === 'POST' && url.pathname === '/desktop/workspace-access') {
      if (confirming) {
        json(409, { error: 'Setup is already running' })
        return true
      }
      confirming = true
      try {
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 2048) throw new Error('Request limit')
          chunks.push(chunk)
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (
          !input ||
          Object.keys(input).some((key) => key !== 'password') ||
          typeof input.password !== 'string' ||
          input.password.length < 12 ||
          input.password.length > 128
        )
          throw new Error(
            'Use a local workspace password of 12–128 characters.'
          )
        if (!(await readOwner())) {
          // Interrupted account creation can be resumed only by authenticating its original local password.
          const exists =
            (
              await services.psql(
                "SELECT EXISTS (SELECT 1 FROM auth.users WHERE email='desktop@localhost.invalid');"
              )
            ).trim() === 't'
          const response = await fetch(
            `http://127.0.0.1:${services.ports.auth}/${exists ? 'token?grant_type=password' : 'admin/users'}`,
            {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(10000),
              headers: {
                'content-type': 'application/json',
                ...(exists
                  ? {}
                  : { authorization: `Bearer ${services.token.service}` })
              },
              body: JSON.stringify({
                email: 'desktop@localhost.invalid',
                password: input.password,
                email_confirm: true
              })
            }
          )
          if (!response.ok)
            throw new Error('Local workspace creation is unavailable.')
          const result = await response.json()
          const subject = exists ? result.user?.id : result.id
          if (!/^[a-f0-9-]{36}$/.test(subject))
            throw new Error('Local account binding is unavailable.')
          const temporary = `${ownerFile}.${randomUUID()}.tmp`
          await writeFile(
            temporary,
            JSON.stringify({ subject, kind: 'personal-holding' }),
            { flag: 'wx', flush: true }
          )
          await rename(temporary, ownerFile)
        }
        json(200, { email: 'desktop@localhost.invalid', playerRequired: true })
      } catch {
        json(409, {
          error:
            'Local workspace access is unavailable. Use your existing local password or retry creation.'
        })
      } finally {
        confirming = false
      }
      return true
    }
    const protectedOperation =
      url.pathname === '/desktop/official-state' ||
      [
        '/desktop/export-personal',
        '/desktop/import-personal',
        '/desktop/connect-official',
        '/desktop/skip-optional'
      ].includes(url.pathname) ||
      url.pathname.startsWith('/desktop/disconnect/')
    if (protectedOperation) {
      if (confirming) {
        json(409, { error: 'Setup is already running' })
        return true
      }
      confirming = true
      try {
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
        confirming = false
      }
    }
    // Demo is an explicit synthetic route, separate from the personal experience.
    if (url.pathname === '/desktop/demo-setup') {
      try {
        await readFile(ownerFile)
        json(409, {
          error: 'A personal workspace exists. Use its local unlock.',
          code: 'EPERSONAL'
        })
        return true
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      return synthetic(req, res, new URL('/desktop/setup', url))
    }
    return synthetic(req, res, url)
  }
  async function official(req, res, url, json) {
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
        const imported = await nativeCommand(['import-personal'])
        gate.assertCurrent()
        onboarding.migrateHistorical(imported)
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
                : 'Official access is unavailable. Retained data can be read offline after local unlock.'
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
