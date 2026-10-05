import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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
          initialized ? 'unlock' : 'create'
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
    if (
      busy ||
      (
        await services.psql(
          'SELECT EXISTS(SELECT 1 FROM public.desktop_preview_setup);'
        )
      ).trim() === 't'
    ) {
      respond(res, 409, { error: 'Unlock the existing workspace.' })
      return true
    }
    busy = true
    try {
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
        Object.keys(input).join(',') !== 'password' ||
        typeof input.password !== 'string' ||
        input.password.length < 12 ||
        input.password.length > 128
      )
        throw new Error('Use a password of 12–128 characters.')
      const existing =
        (
          await services.psql(
            "SELECT EXISTS(SELECT 1 FROM auth.users WHERE email='desktop@localhost.invalid');"
          )
        ).trim() === 't'
      const response = await fetch(
        `http://127.0.0.1:${services.ports.auth}/${existing ? 'token?grant_type=password' : 'admin/users'}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${services.token.service}`
          },
          body: JSON.stringify({
            email: 'desktop@localhost.invalid',
            password: input.password,
            ...(existing ? {} : { email_confirm: true })
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10000)
        }
      )
      input.password = ''
      if (!response.ok) throw new Error('Local account setup could not finish.')
      const result = await response.json(),
        subject = existing ? result.user?.id : result.id
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subject))
        throw new Error('Local account setup could not finish.')
      await services.psql(
        `INSERT INTO public.desktop_preview_setup(singleton,subject_user_id) VALUES(true,'${subject}');`
      )
      respond(res, 200, { status: 'player-required', cloudContribution: 'off' })
    } catch {
      respond(res, 400, {
        error:
          'Local setup could not finish. Existing data is retained; check your workspace password and retry.'
      })
    } finally {
      busy = false
    }
    return true
  }
}
