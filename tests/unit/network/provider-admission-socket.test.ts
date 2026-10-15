import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { createProviderAdmission } from '@/supabase/functions/_shared/provider-admission'

it('closes a real HTTP body and stops after the authority disables an active request', async () => {
  let sends = 0
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const server = createServer((request, response) => {
    sends++
    request.socket.once('close', resolveClosed)
    response.writeHead(200)
    response.write('synthetic first chunk')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('missing test listener')
  const origin = `http://127.0.0.1:${address.port}`
  let disabled = false
  let resolveOutcome!: (settled: unknown) => void
  const outcome = new Promise<unknown>((resolve) => {
    resolveOutcome = resolve
  })
  const client = createProviderAdmission({
    authorityOrigin: 'http://authority.example.invalid',
    officialOrigin: origin,
    token: 'synthetic-control',
    pollMs: 100,
    controlFetch: async (input, init) => {
      const operation = String(input).split('/').at(-1)
      const body = JSON.parse(String(init?.body))
      if (operation === 'reserve' || operation === 'dispatch')
        return Response.json({
          status: operation === 'reserve' ? 'reserved' : 'dispatch',
          attemptId: body.attemptId,
          timeoutMs: 5000,
          [operation === 'reserve' ? 'claimUntil' : 'deadline']: new Date(
            Date.now() + 2000
          ).toISOString()
        })
      if (operation === 'check' && disabled)
        return Response.json({
          status: 'denied',
          reason: 'disabled',
          retryAfterSeconds: 60
        })
      if (operation === 'outcome') resolveOutcome(body.settled)
      return Response.json({ status: 'continue' })
    }
  })
  try {
    const response = await client.fetch(
      `${origin}/api/v1/player`,
      {},
      {
        domain: 'official',
        account: 'a'.repeat(64),
        endpoint: '/api/v1/player',
        purpose: 'roster-fetch',
        priority: 'background',
        timeoutMs: 5000
      }
    )
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'synthetic first chunk'
    )
    disabled = true
    await expect(reader.read()).rejects.toThrow('Provider traffic unavailable')
    await closed
    expect(await outcome).toBe(true)
    expect(sends).toBe(1)
  } finally {
    const done = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await done
  }
})
