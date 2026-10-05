import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export async function createPersonalWorkspace(services) {
  const existing = JSON.parse(
    (
      await services.psql(`SELECT json_build_object(
        'subject',(SELECT id FROM auth.users WHERE email='desktop@localhost.invalid'),
        'occupied',EXISTS(SELECT 1 FROM public.player_mapping) OR EXISTS(SELECT 1 FROM public.guild_config) OR EXISTS(SELECT 1 FROM public."EOT_GR_data")
      );`)
    ).trim()
  )
  if (existing.occupied)
    throw new Error('Existing local data requires recovery')
  const subjectPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  if (existing.subject !== null && !subjectPattern.test(existing.subject ?? ''))
    throw new Error('Interrupted local account is invalid')
  const base = `http://127.0.0.1:${services.ports.auth}`
  let credential = randomBytes(48).toString('base64url')
  try {
    const response = await fetch(
      `${base}/admin/users${existing.subject ? '/' + existing.subject : ''}`,
      {
        method: existing.subject ? 'PUT' : 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${services.token.service}`
        },
        body: JSON.stringify({
          email: 'desktop@localhost.invalid',
          password: credential,
          email_confirm: true
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      }
    )
    if (!response.ok) throw new Error('Local account creation failed')
    const account = await response.json()
    if (
      !subjectPattern.test(account.id ?? '') ||
      (existing.subject && account.id !== existing.subject)
    )
      throw new Error('Local account owner does not match')
    await services.psql(
      `INSERT INTO public.desktop_preview_setup(singleton,subject_user_id) VALUES(true,'${account.id}');`
    )
    return account.id
  } finally {
    credential = ''
  }
}

// A local Auth account starts in a Player-required holding state. No invented
// game identity or synthetic raid data is assigned to an ordinary workspace.
export function personalWorkspace(services, assets) {
  let busy = false
  const respond = (res, status, value) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    res.end(JSON.stringify(value))
  }
  return async (req, res, url) => {
    const files = {
      '/desktop/setup': 'setup.html',
      '/desktop/setup.js': 'setup.js',
      '/desktop/personal': 'personal.html',
      '/desktop/personal.js': 'personal.js'
    }
    if (req.method === 'GET' && Object.hasOwn(files, url.pathname)) {
      let content = await readFile(join(assets, files[url.pathname]), 'utf8')
      if (url.pathname === '/desktop/setup') {
        const initialized =
          (
            await services.psql(
              'SELECT EXISTS(SELECT 1 FROM public.desktop_preview_setup);'
            )
          ).trim() === 't'
        content = content.replaceAll(
          'SETUP_MODE',
          initialized ? 'open' : 'create'
        )
      }
      res.writeHead(200, {
        'content-type': url.pathname.endsWith('.js')
          ? 'text/javascript'
          : 'text/html',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      })
      res.end(content)
      return true
    }
    if (url.pathname !== '/desktop/setup' || req.method !== 'POST') return false
    if (busy) {
      respond(res, 409, { error: 'Open the existing workspace.' })
      return true
    }
    busy = true
    try {
      if (
        (
          await services.psql(
            'SELECT EXISTS(SELECT 1 FROM public.desktop_preview_setup);'
          )
        ).trim() === 't'
      ) {
        respond(res, 409, { error: 'Open the existing workspace.' })
        return true
      }
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 4096) throw new Error('Invalid setup input')
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks))
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length !== 0
      )
        throw new Error('Invalid local setup input')
      await createPersonalWorkspace(services)
      respond(res, 200, { status: 'player-required', cloudContribution: 'off' })
    } catch {
      respond(res, 400, {
        error:
          'Local setup could not finish. Existing data was preserved. Reopen the app to retry.'
      })
    } finally {
      busy = false
    }
    return true
  }
}
