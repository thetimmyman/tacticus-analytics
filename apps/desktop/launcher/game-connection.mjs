import { timingSafeEqual } from 'node:crypto'
import {
  nativeSessionRequest,
  workspaceAuthorized
} from './workspace-session.mjs'

const respond = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify(body))
}
// Main-process-only context/status mutations use a separate capability which is
// never injected into renderer requests. No game key enters this coordinator.
export function workspaceGameConnection(
  services,
  { brokerToken, clock = Date.now } = {}
) {
  let status = { connected: false },
    nextAttempt = 0,
    busy = false
  const record = async () =>
    JSON.parse(
      (
        await services.psql(
          `SELECT coalesce((SELECT json_build_object('installation',subject_user_id,'guildCode',guild_code,'mode',identity_mode) FROM public.desktop_preview_setup WHERE singleton),'null'::json);`
        )
      ).trim()
    )
  return async (req, res, url) => {
    if (url.pathname === '/desktop/connection-status' && req.method === 'GET') {
      if (
        status.expiresAt !== null &&
        status.expiresAt !== undefined &&
        status.expiresAt <= clock()
      )
        status = { connected: false }
      respond(res, 200, status)
      return true
    }
    if (
      ![
        '/desktop/broker-context',
        '/desktop/broker-status',
        '/desktop/addon-context'
      ].includes(url.pathname)
    )
      return false
    const supplied = req.headers['x-desktop-broker']
    if (
      req.method !== 'POST' ||
      typeof brokerToken !== 'string' ||
      !/^[a-f0-9]{64}$/.test(brokerToken) ||
      typeof supplied !== 'string' ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(brokerToken))
    ) {
      respond(res, 403, { error: 'Native connection request denied.' })
      return true
    }
    const contextRequest = url.pathname === '/desktop/broker-context'
    const addonContext = url.pathname === '/desktop/addon-context'
    if (contextRequest && (busy || clock() < nextAttempt)) {
      respond(res, 429, { error: 'Please wait before trying again.' })
      return true
    }
    if (contextRequest) {
      busy = true
      nextAttempt = clock() + 3000
    }
    try {
      let bytes = 0
      const chunks = []
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 16384) {
          respond(res, 413, { error: 'Native request is too large.' })
          return true
        }
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Invalid input')
      if (contextRequest || addonContext) {
        if (
          (addonContext &&
            (Object.keys(input).length !== 0 ||
              !nativeSessionRequest(req, brokerToken))) ||
          (!addonContext &&
            Object.keys(input).some((key) => key !== 'password')) ||
          (!nativeSessionRequest(req, brokerToken) &&
            (typeof input.password !== 'string' ||
              input.password.length < 12 ||
              input.password.length > 128))
        )
          throw new Error('Invalid input')
        const expected = await record()
        if (
          !expected ||
          !(addonContext
            ? ['local-file', 'sample'].includes(expected.mode)
            : expected.mode === 'local-file')
        ) {
          respond(res, 409, {
            error:
              'Create a local-file workspace with your guild tag before connecting.'
          })
          return true
        }
        if (
          !(await workspaceAuthorized(
            services,
            req,
            input,
            expected.installation,
            brokerToken
          ))
        ) {
          respond(res, 401, { error: 'Unlock your workspace to continue.' })
          return true
        }
        respond(res, 200, {
          installation: expected.installation,
          guildCode: expected.guildCode
        })
      } else {
        if (
          Object.keys(input).some(
            (key) =>
              !['connected', 'installation', 'guildCode', 'expiresAt'].includes(
                key
              )
          ) ||
          typeof input.connected !== 'boolean'
        )
          throw new Error('Invalid input')
        if (input.connected) {
          const expected = await record()
          if (
            !expected ||
            input.installation !== expected.installation ||
            input.guildCode !== expected.guildCode ||
            (input.expiresAt !== null &&
              (!Number.isSafeInteger(input.expiresAt) ||
                input.expiresAt <= clock()))
          )
            throw new Error('Invalid binding')
          status = {
            connected: true,
            guildCode: expected.guildCode,
            expiresAt: input.expiresAt
          }
        } else status = { connected: false }
        respond(res, 200, status)
      }
    } catch {
      respond(res, 400, { error: 'Native connection request failed.' })
    } finally {
      if (contextRequest) busy = false
    }
    return true
  }
}
