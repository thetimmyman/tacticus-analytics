import { randomBytes, timingSafeEqual } from 'node:crypto'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const ownerQuery = `SELECT coalesce((SELECT json_build_object('subject',s.subject_user_id) FROM public.desktop_preview_setup s JOIN auth.users u ON u.id=s.subject_user_id WHERE s.singleton AND u.email='desktop@localhost.invalid'),'null'::json);`

// The native coordinator alone owns this capability. Transport authorization
// is checked independently by the loopback gateway before this handler.
export function deviceSessionRequest(req, capability) {
  const supplied = req.headers?.['x-desktop-broker']
  return (
    typeof capability === 'string' &&
    /^[a-f0-9]{64}$/.test(capability) &&
    typeof supplied === 'string' &&
    /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(capability))
  )
}

export async function readDeviceSessionJSON(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Invalid local session response')
  let bytes = 0
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 65536) throw new Error('Invalid local session response')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    await reader.cancel().catch(() => {})
    throw new Error('Invalid local session response')
  } finally {
    reader.releaseLock()
  }
}

// Only standard Auth fields reach ordinary cookies. Unexpected coordinator
// fields or metadata never enter the renderer session.
export function projectDeviceSession(
  value,
  { subject, now = Date.now() } = {}
) {
  try {
    if (
      !value ||
      !uuid.test(value.user?.id ?? '') ||
      (subject !== undefined && value.user.id !== subject) ||
      typeof value.access_token !== 'string' ||
      value.access_token.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        value.access_token
      ) ||
      typeof value.refresh_token !== 'string' ||
      !/^[A-Za-z0-9_-]{1,4096}$/.test(value.refresh_token) ||
      value.token_type !== 'bearer' ||
      !Number.isSafeInteger(value.expires_in) ||
      value.expires_in < 1 ||
      value.expires_in > 86400
    )
      throw new Error()
    const [headerText, claimsText] = value.access_token.split('.')
    const header = JSON.parse(Buffer.from(headerText, 'base64url'))
    const claims = JSON.parse(Buffer.from(claimsText, 'base64url'))
    if (
      header.alg !== 'HS256' ||
      claims.sub !== value.user.id ||
      claims.role !== 'authenticated' ||
      !(
        claims.aud === 'authenticated' ||
        (Array.isArray(claims.aud) && claims.aud.includes('authenticated'))
      ) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1000 <= now ||
      claims.exp * 1000 > now + 86400000 ||
      (claims.nbf !== undefined &&
        (!Number.isSafeInteger(claims.nbf) || claims.nbf * 1000 > now)) ||
      (value.expires_at !== undefined && value.expires_at !== claims.exp)
    )
      throw new Error()
    return {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      token_type: 'bearer',
      expires_in: Math.min(
        value.expires_in,
        claims.exp - Math.floor(now / 1000)
      ),
      expires_at: claims.exp,
      user: { id: value.user.id }
    }
  } catch {
    throw new Error('Invalid local session')
  }
}

export function workspaceDeviceSession(
  services,
  { brokerToken, synthetic = false } = {}
) {
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
    if (
      req.method !== 'POST' ||
      url.search ||
      url.hash ||
      req.headers?.origin !== url.origin ||
      !deviceSessionRequest(req, brokerToken)
    ) {
      respond(res, 403, { error: 'Native workspace access required.' })
      return true
    }
    if (busy) {
      respond(res, 409, {
        code: 'WORKSPACE_OPENING',
        error: 'Workspace is opening.'
      })
      return true
    }
    busy = true
    let credential = ''
    try {
      const owner = JSON.parse((await services.psql(ownerQuery)).trim())
      if (owner === null) {
        respond(res, 409, {
          code: 'WORKSPACE_NOT_CREATED',
          error: 'Create a workspace first.'
        })
        return true
      }
      if (!uuid.test(owner?.subject ?? '')) throw new Error()
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
      await changed.body?.cancel()
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
      const session = projectDeviceSession(await readDeviceSessionJSON(login), {
        subject: owner.subject
      })
      const verified = await fetch(`${base}/user`, {
        headers: { authorization: `Bearer ${session.access_token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      })
      if (
        !verified.ok ||
        (await readDeviceSessionJSON(verified)).id !== owner.subject
      )
        throw new Error()
      const current = JSON.parse((await services.psql(ownerQuery)).trim())
      if (current?.subject !== owner.subject) throw new Error()
      respond(res, 200, {
        session,
        destination: synthetic ? '/home' : '/desktop/personal'
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
