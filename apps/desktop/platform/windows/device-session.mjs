import { randomBytes, timingSafeEqual } from 'node:crypto'

const email = 'desktop@localhost.invalid'
const uuid = /^[a-f0-9-]{36}$/
export function deviceSessionRequest(req, capability) {
  const supplied = req.headers['x-desktop-broker']
  return (
    [supplied, capability].every(
      (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    ) && timingSafeEqual(Buffer.from(supplied), Buffer.from(capability))
  )
}

// Called only from the inherited native main channel. No renderer route receives this capability.
export function deviceSessionBootstrap({
  services,
  capability,
  readOwner,
  writeOwner
}) {
  let pending = false
  return async (req, res, url) => {
    if (url.pathname !== '/desktop/open') return false
    const respond = (code, value) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      res.end(JSON.stringify(value))
    }
    if (req.method !== 'POST' || !deviceSessionRequest(req, capability)) {
      respond(403, { error: 'Native workspace opening is required.' })
      return true
    }
    if (pending) {
      respond(409, { error: 'Workspace opening is in progress.' })
      return true
    }
    pending = true
    let credential
    try {
      let subject = await readOwner()
      const stored = JSON.parse(
        (
          await services.psql(`SELECT json_build_object(
        'subject', (SELECT id FROM auth.users WHERE email='desktop@localhost.invalid'),
        'demo', EXISTS(SELECT 1 FROM public.desktop_preview_setup),
        'occupied', EXISTS(SELECT 1 FROM public.player_mapping) OR EXISTS(SELECT 1 FROM public.guild_config) OR EXISTS(SELECT 1 FROM public."EOT_GR_data")
      );`)
        ).trim()
      )
      if (subject && stored.subject !== subject)
        throw new Error('Owner mismatch')
      if (!subject && stored.subject) {
        if (!uuid.test(stored.subject)) throw new Error('Invalid owner')
        subject = stored.subject // Resume the same interrupted or former password account.
      }
      if (!subject && stored.occupied) throw new Error('Unbound local data')
      credential = randomBytes(48).toString('base64url')
      const response = await fetch(
        `http://127.0.0.1:${services.ports.auth}/admin/users${subject ? '/' + subject : ''}`,
        {
          method: subject ? 'PUT' : 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            authorization: `Bearer ${services.token.service}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            email,
            password: credential,
            email_confirm: true
          })
        }
      )
      if (!response.ok) throw new Error('Local Auth unavailable')
      const account = await response.json()
      if (!uuid.test(account.id) || (subject && account.id !== subject))
        throw new Error('Owner mismatch')
      subject = account.id
      // Record the stable owner before login, so a failed login can resume without replacing local data.
      await writeOwner(subject)
      const login = await fetch(
        `http://127.0.0.1:${services.ports.auth}/token?grant_type=password`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: credential })
        }
      )
      if (!login.ok) throw new Error('Local Auth unavailable')
      const grant = await login.json()
      if (
        grant.user?.id !== subject ||
        typeof grant.refresh_token !== 'string' ||
        JSON.stringify(grant).length > 65536 ||
        !services.validOwnerSession(grant.access_token, subject)
      )
        throw new Error('Invalid owner session')
      respond(200, {
        session: grant,
        destination: stored.demo
          ? '/player-performance?guild=SYN001&season=9999'
          : '/desktop/setup'
      })
    } catch {
      respond(503, {
        error: 'The local workspace could not open. Try reopening the app.'
      })
    } finally {
      credential = undefined
      pending = false
    }
    return true
  }
}
