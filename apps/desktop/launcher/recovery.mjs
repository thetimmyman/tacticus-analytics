import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const email = 'desktop@localhost.invalid'
const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`
const hash = (value) => createHash('sha256').update(value).digest('hex')
const passwordValid = (value) =>
  typeof value === 'string' && value.length >= 12 && value.length <= 128

// The gateway checks transport authorization and browser origin before this
// coordinator runs. Neither endpoint accepts an account identifier or SQL.
export function workspaceRecovery(services) {
  let busy = false
  let nextAttempt = 0
  const reply = (res, status, value) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    res.end(JSON.stringify(value))
  }
  return async (req, res, url) => {
    if (
      !['/desktop/recovery-code', '/desktop/reset-password'].includes(
        url.pathname
      )
    )
      return false
    if (req.method !== 'POST') {
      reply(res, 405, { error: 'Use a recovery form.' })
      return true
    }
    if (busy || Date.now() < nextAttempt) {
      reply(res, 429, { error: 'Please wait before trying recovery again.' })
      return true
    }
    busy = true
    nextAttempt = Date.now() + 3000
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 4096) {
          reply(res, 413, { error: 'Recovery request is too large.' })
          return true
        }
        chunks.push(chunk)
      }
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        reply(res, 400, { error: 'Invalid recovery request.' })
        return true
      }
      const fields =
        url.pathname === '/desktop/recovery-code'
          ? ['password']
          : ['password', 'code']
      if (
        !input ||
        !passwordValid(input.password) ||
        Object.keys(input).some((field) => !fields.includes(field))
      ) {
        reply(res, 400, { error: 'Use a password of 12–128 characters.' })
        return true
      }
      const record = JSON.parse(
        (
          await services.psql(
            `SELECT coalesce((SELECT json_build_object('subject',subject_user_id,'hash',recovery_code_hash) FROM public.desktop_preview_setup WHERE singleton),'null'::json);`
          )
        ).trim()
      )
      if (!record || !/^[a-f0-9-]{36}$/.test(record.subject)) {
        reply(res, 409, {
          error: 'Create a workspace before setting up recovery.'
        })
        return true
      }
      if (url.pathname === '/desktop/recovery-code') {
        const login = await fetch(
          `http://127.0.0.1:${services.ports.auth}/token?grant_type=password`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password: input.password }),
            signal: AbortSignal.timeout(10000)
          }
        )
        if (!login.ok || (await login.json()).user?.id !== record.subject) {
          reply(res, 401, { error: 'Check your current workspace password.' })
          return true
        }
        const code = randomBytes(32).toString('hex')
        await services.psql(
          `UPDATE public.desktop_preview_setup SET recovery_code_hash=${quoted(hash(code))} WHERE singleton AND subject_user_id=${quoted(record.subject)};`
        )
        reply(res, 201, { code })
        return true
      }
      const validCode =
        typeof input.code === 'string' && /^[a-f0-9]{64}$/.test(input.code)
      const supplied = hash(validCode ? input.code : '')
      if (
        !validCode ||
        !/^[a-f0-9]{64}$/.test(record.hash || '') ||
        !timingSafeEqual(
          Buffer.from(supplied, 'hex'),
          Buffer.from(record.hash, 'hex')
        )
      ) {
        reply(res, 401, { error: 'Check your saved recovery code.' })
        return true
      }
      // The pinned Auth implementation changes the password and invalidates
      // refresh sessions in one transaction. Preserve the recovery code so a
      // lost response can be retried without locking out the workspace owner.
      const changed = await fetch(
        `http://127.0.0.1:${services.ports.auth}/admin/users/${record.subject}`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${services.token.service}`
          },
          body: JSON.stringify({ password: input.password }),
          signal: AbortSignal.timeout(10000)
        }
      )
      if (!changed.ok) throw new Error('Local password change failed')
      reply(res, 200, { changed: true })
      return true
    } finally {
      busy = false
    }
  }
}
