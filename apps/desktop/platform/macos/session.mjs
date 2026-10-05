import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { workspaceAuthorized } from '../../launcher/workspace-session.mjs'

const sessionError = () =>
  Object.assign(new Error('Unlock your local workspace to continue.'), {
    code: 'ESESSION'
  })

// Auth is the authority. This local signature/expiry check also guards the final
// synchronous state commit after native input or an upstream request has awaited.
export function assertSession(token, subject, signingKey, now = Date.now()) {
  try {
    if (
      typeof token !== 'string' ||
      token.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    )
      throw sessionError()
    const parts = token.split('.'),
      header = JSON.parse(Buffer.from(parts[0], 'base64url')),
      claims = JSON.parse(Buffer.from(parts[1], 'base64url')),
      actual = Buffer.from(parts[2], 'base64url'),
      expected = createHmac('sha256', signingKey)
        .update(parts.slice(0, 2).join('.'))
        .digest()
    if (
      header.alg !== 'HS256' ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected) ||
      claims.sub !== subject ||
      claims.role !== 'authenticated' ||
      !(
        claims.aud === 'authenticated' ||
        (Array.isArray(claims.aud) && claims.aud.includes('authenticated'))
      ) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1000 <= now ||
      (claims.nbf !== undefined &&
        (!Number.isSafeInteger(claims.nbf) || claims.nbf * 1000 > now))
    )
      throw sessionError()
  } catch {
    throw sessionError()
  }
}

export function localSessionGate({
  services,
  signingKey,
  now = () => Date.now()
}) {
  const capability = randomBytes(32).toString('hex')
  return {
    async authorize(token) {
      const subject = (
        await services.psql(
          'SELECT subject_user_id FROM public.desktop_preview_setup WHERE singleton;'
        )
      ).trim()
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subject))
        throw sessionError()
      const assert = () => assertSession(token, subject, signingKey, now())
      assert()
      if (
        !(await workspaceAuthorized(
          services,
          {
            headers: {
              authorization: `Bearer ${token}`,
              'x-desktop-broker': capability
            }
          },
          {},
          subject,
          capability
        ))
      )
        throw sessionError()
      assert()
      return { assert }
    }
  }
}
