import { timingSafeEqual } from 'node:crypto'

export function nativeSessionRequest(req, brokerToken) {
  const supplied = req.headers['x-desktop-broker']
  const authorization = req.headers.authorization
  return (
    typeof brokerToken === 'string' &&
    /^[a-f0-9]{64}$/.test(brokerToken) &&
    typeof supplied === 'string' &&
    /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(brokerToken)) &&
    typeof authorization === 'string' &&
    /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
      authorization
    ) &&
    authorization.length <= 16384
  )
}

export function browserWorkspaceToken(req) {
  try {
    const cookies = String(req.headers.cookie ?? '')
      .split(';')
      .map((part) => {
        const index = part.indexOf('=')
        return {
          name: part.slice(0, index).trim(),
          value: part.slice(index + 1).trim()
        }
      })
    return currentWorkspaceToken(cookies)
  } catch {
    return null
  }
}

export async function workspaceAuthorized(
  services,
  req,
  input,
  subject,
  brokerToken
) {
  const browserToken = browserWorkspaceToken(req)
  if (nativeSessionRequest(req, brokerToken) || browserToken) {
    const response = await fetch(
      `http://127.0.0.1:${services.ports.auth}/user`,
      {
        headers: {
          authorization: browserToken
            ? `Bearer ${browserToken}`
            : req.headers.authorization
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      }
    )
    return response.ok && (await response.json()).id === subject
  }
  if (
    typeof input.password !== 'string' ||
    input.password.length < 12 ||
    input.password.length > 128
  )
    return false
  const response = await fetch(
    `http://127.0.0.1:${services.ports.auth}/token?grant_type=password`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'desktop@localhost.invalid',
        password: input.password
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    }
  )
  return response.ok && (await response.json()).user?.id === subject
}

// Cookie decoding is only a token lookup. Auth verifies its signature, expiry
// and workspace owner before any credential access or data write is authorized.
export function currentWorkspaceToken(cookies) {
  const selected = cookies.filter((cookie) =>
    /^tacticus-auth-token(?:\.\d{1,2})?$/.test(cookie.name)
  )
  if (!selected.length || selected.length > 16)
    throw Object.assign(
      new Error('Reopen the app to restore your local session.'),
      {
        code: 'ESESSION'
      }
    )
  const whole = selected.find((cookie) => cookie.name === 'tacticus-auth-token')
  let text
  if (whole) text = whole.value
  else {
    selected.sort(
      (a, b) =>
        Number(a.name.split('.').at(-1)) - Number(b.name.split('.').at(-1))
    )
    if (
      selected.some((cookie, i) => cookie.name !== `tacticus-auth-token.${i}`)
    )
      throw Object.assign(
        new Error('Reopen the app to restore your local session.'),
        {
          code: 'ESESSION'
        }
      )
    text = selected.map((cookie) => cookie.value).join('')
  }
  try {
    if (typeof text !== 'string' || text.length > 65536) throw new Error()
    text = text.startsWith('base64-')
      ? Buffer.from(text.slice(7), 'base64url').toString('utf8')
      : decodeURIComponent(text)
    const value = JSON.parse(text).access_token
    if (
      typeof value !== 'string' ||
      value.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error()
    return value
  } catch {
    throw Object.assign(
      new Error('Reopen the app to restore your local session.'),
      {
        code: 'ESESSION'
      }
    )
  }
}
