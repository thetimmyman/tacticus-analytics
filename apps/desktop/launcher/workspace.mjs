import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  syntheticRaidFixture,
  importSyntheticRaid
} from '../proof/synthetic-import.mjs'

const email = 'desktop@localhost.invalid'
export function workspaceSetup(services, assets) {
  let busy = false
  const ownerPath = join(services.state, 'workspace-owner.json')
  const initialized = async () => {
    try {
      await readFile(ownerPath)
      return true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return false
    }
  }
  const respond = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    res.end(JSON.stringify(body))
  }
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/desktop/')) return false
    if (
      req.method === 'GET' &&
      ['/desktop/setup', '/desktop/setup.js', '/desktop/style.css'].includes(
        url.pathname
      )
    ) {
      const file =
        url.pathname === '/desktop/setup'
          ? 'setup.html'
          : url.pathname.slice('/desktop/'.length)
      let content = await readFile(join(assets, file), 'utf8')
      if (file === 'setup.html')
        content = content.replaceAll(
          'SETUP_MODE',
          (await initialized()) ? 'unlock' : 'create'
        )
      res.writeHead(200, {
        'content-type': file.endsWith('.js')
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
        typeof input.password !== 'string' ||
        input.password.length < 12 ||
        input.password.length > 128 ||
        input.sample !== true
      ) {
        respond(res, 400, {
          error:
            'Use a password of 12–128 characters and confirm the synthetic sample.'
        })
        return true
      }
      const response = await fetch(
        `http://127.0.0.1:${services.ports.auth}/admin/users`,
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
      if (!response.ok) throw new Error('Local account creation failed')
      const account = await response.json()
      try {
        await importSyntheticRaid(services, syntheticRaidFixture(account.id))
      } catch (error) {
        // Compensate a failed local fixture transaction; never leave a usable
        // half-created account. This endpoint touches only this installation.
        const rollback = await fetch(
          `http://127.0.0.1:${services.ports.auth}/admin/users/${account.id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${services.token.service}` },
            signal: AbortSignal.timeout(10000)
          }
        )
        if (!rollback.ok)
          throw new Error('Account rollback failed; setup requires recovery')
        throw error
      }
      await writeFile(
        ownerPath,
        JSON.stringify({
          id: account.id,
          email,
          kind: 'synthetic-preview-workspace'
        }),
        { flag: 'wx', mode: 0o600 }
      )
      respond(res, 201, { email })
      return true
    } finally {
      busy = false
    }
  }
}
