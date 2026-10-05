import { timingSafeEqual } from 'node:crypto'
import { parseRosterSnapshot } from './roster-validation.mjs'

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const reply = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify(value))
}
export function workspaceRosterImport(
  services,
  { brokerToken, normalizeRoster } = {}
) {
  let busy = false,
    nextAttempt = 0
  return async (req, res, url) => {
    if (url.pathname !== '/desktop/import-roster') return false
    const supplied = req.headers['x-desktop-broker']
    if (
      req.method !== 'POST' ||
      url.search ||
      typeof brokerToken !== 'string' ||
      !/^[a-f0-9]{64}$/.test(brokerToken) ||
      typeof supplied !== 'string' ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(brokerToken))
    ) {
      reply(res, 403, { error: 'Native roster request denied.' })
      return true
    }
    if (busy || Date.now() < nextAttempt) {
      reply(res, 429, { error: 'Please wait before trying again.' })
      return true
    }
    busy = true
    nextAttempt = Date.now() + 3000
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 8 * 1024 * 1024) {
          reply(res, 413, { error: 'Roster is too large.' })
          return true
        }
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (key) => !['password', 'contents'].includes(key)
        ) ||
        typeof input.password !== 'string' ||
        input.password.length < 12 ||
        input.password.length > 128
      )
        throw new Error('Invalid input')
      const snapshot = parseRosterSnapshot(input.contents)
      const record = JSON.parse(
        (
          await services.psql(
            `SELECT coalesce((SELECT json_build_object('subject',subject_user_id,'guildCode',guild_code) FROM public.desktop_preview_setup WHERE singleton AND identity_mode='local-file'),'null'::json);`
          )
        ).trim()
      )
      if (
        !record ||
        snapshot.guildCode !== record.guildCode ||
        typeof record.subject !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.subject)
      ) {
        reply(res, 409, {
          error: 'Check the current local-file workspace and guild tag.'
        })
        return true
      }
      const login = await fetch(
        `http://127.0.0.1:${services.ports.auth}/token?grant_type=password`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'desktop@localhost.invalid',
            password: input.password
          }),
          signal: AbortSignal.timeout(10000)
        }
      )
      if (!login.ok || (await login.json()).user?.id !== record.subject) {
        reply(res, 401, { error: 'Check your current workspace password.' })
        return true
      }
      const normalized = await normalizeRoster(
        JSON.stringify(snapshot),
        record.subject
      )
      if (!Array.isArray(normalized.rows) || normalized.rows.length > 1152)
        throw new Error('Invalid normalization')
      const result = (
        await services.psql(`BEGIN;
        SELECT set_config('request.jwt.claims',${quote(JSON.stringify({ sub: record.subject, role: 'authenticated' }))},true);
        SELECT 'desktop-roster-result:'||public.desktop_save_roster(${quote(JSON.stringify(snapshot))}::jsonb,${quote(JSON.stringify(normalized.rows))}::jsonb)::text;
        COMMIT;`)
      )
        .split('\n')
        .find((line) => line.startsWith('desktop-roster-result:'))
      if (!result) throw new Error('Invalid result')
      reply(res, 200, JSON.parse(result.slice('desktop-roster-result:'.length)))
    } catch {
      reply(res, 400, {
        error:
          'Roster update could not complete. Existing roster was preserved.'
      })
    } finally {
      busy = false
    }
    return true
  }
}
