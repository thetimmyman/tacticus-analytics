import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { workspaceSetup } from '../../launcher/workspace.mjs'
import { windowsOnboarding } from './onboarding.mjs'
import { nativeCommand } from './native-command.mjs'

export function windowsSetup(services, assets, launcherAssets) {
  const onboarding = windowsOnboarding(services.state)
  const synthetic = workspaceSetup(services, launcherAssets)
  let confirming = false
  return async (req, res, url) => {
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
    if (req.method === 'GET' && url.pathname === '/desktop/official-state') {
      json(200, onboarding.view())
      return true
    }
    if (req.method === 'POST' && url.pathname === '/desktop/export-personal') {
      try {
        json(
          200,
          await nativeCommand(
            ['export-personal'],
            JSON.stringify(onboarding.view())
          )
        )
      } catch {
        json(503, {
          error: 'Native file choice or protected export is unavailable.'
        })
      }
      return true
    }
    if (req.method === 'POST' && url.pathname === '/desktop/import-personal') {
      try {
        onboarding.migrateHistorical(await nativeCommand(['import-personal']))
        json(200, onboarding.view())
      } catch {
        json(409, {
          error:
            'Import needs an empty workspace and a supported secret-free local projection.'
        })
      }
      return true
    }
    if (req.method === 'POST' && url.pathname === '/desktop/connect-official') {
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
      } catch {
        json(503, {
          error:
            'Secure official access unavailable. Retained data can be read offline.'
        })
      } finally {
        confirming = false
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
    // Demo is an explicit synthetic route, separate from the personal experience.
    if (url.pathname === '/desktop/demo-setup') {
      return synthetic(req, res, new URL('/desktop/setup', url))
    }
    return synthetic(req, res, url)
  }
}
