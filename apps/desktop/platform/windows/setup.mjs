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
    if (req.method === 'POST' && url.pathname === '/desktop/connect-official') {
      if (confirming) {
        json(409, { error: 'Setup is already running' })
        return true
      }
      confirming = true
      try {
        // Native prompt conveys consent; native confirmation is a separate fixed operation.
        const view = await onboarding.connect({
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
