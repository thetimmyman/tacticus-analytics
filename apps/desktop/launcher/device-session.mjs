import { randomBytes, timingSafeEqual } from 'node:crypto'

// This capability belongs to Electron main, never the renderer or an external browser.
export function deviceSessionRequest(req, capability) {
  const supplied = req.headers['x-desktop-broker']
  return (
    typeof capability === 'string' &&
    /^[a-f0-9]{64}$/.test(capability) &&
    typeof supplied === 'string' &&
    /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(capability))
  )
}

export function workspaceDeviceSession(services, { brokerToken } = {}) {
  let busy = false
  const respond = (res, status, value) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    res.end(JSON.stringify(value))
  }
  return async (req, res, url) => {
    if (url.pathname !== '/desktop/open') return false
    if (req.method !== 'POST' || !deviceSessionRequest(req, brokerToken)) {
      respond(res, 403, { error: 'Native workspace access required.' })
      return true
    }
    if (busy) {
      respond(res, 409, { error: 'Workspace is opening.' })
      return true
    }
    busy = true
    let credential = ''
    try {
      // Preserve the existing owner and all data. Only its local Auth credential changes.
      const owner = JSON.parse(
        (
          await services.psql(
            `SELECT coalesce((SELECT json_build_object('subject',s.subject_user_id,'sample',s.identity_mode='sample') FROM public.desktop_preview_setup s JOIN auth.users u ON u.id=s.subject_user_id WHERE s.singleton AND u.email='desktop@localhost.invalid'),'null'::json);`
          )
        ).trim()
      )
      if (!owner) {
        respond(res, 409, { error: 'Create a workspace first.' })
        return true
      }
      if (!/^[a-f0-9-]{36}$/.test(owner.subject)) throw new Error()
      // Auth still enforces signed, expiring owner sessions. No user password is stored.
      credential = randomBytes(48).toString('base64url')
      const base = `http://127.0.0.1:${services.ports.auth}`
      const changed = await fetch(`${base}/admin/users/${owner.subject}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${services.token.service}`
        },
        body: JSON.stringify({ password: credential }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      })
      if (!changed.ok) throw new Error()
      const login = await fetch(`${base}/token?grant_type=password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'desktop@localhost.invalid',
          password: credential
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      })
      if (!login.ok) throw new Error()
      const session = await login.json()
      if (
        session.user?.id !== owner.subject ||
        typeof session.access_token !== 'string' ||
        typeof session.refresh_token !== 'string'
      )
        throw new Error()
      respond(res, 200, {
        session,
        destination: owner.sample ? '/home' : '/desktop/connect'
      })
    } catch {
      respond(res, 503, {
        error:
          'The local workspace could not open. Existing data was preserved. Try reopening the app.'
      })
    } finally {
      credential = ''
      busy = false
    }
    return true
  }
}
