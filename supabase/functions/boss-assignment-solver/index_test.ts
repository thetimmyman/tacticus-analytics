import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handler } from './handler.ts'
import { authorizeSolverGuildRequest } from './solver-auth.ts'

Deno.test(
  'boss-assignment-solver - rejects unauthenticated requests',
  async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({})
    })

    const res = await handler(req)
    assertEquals(res.status, 401)
    const body = await res.json()
    assertEquals(body.error, 'Unauthorized')
  }
)

Deno.test('boss-assignment-solver - Options Request', async () => {
  const req = new Request('http://localhost', {
    method: 'OPTIONS'
  })

  const res = await handler(req)
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
})

Deno.test('boss-assignment-solver - rejects cross-guild users', async () => {
  const request = new Request('http://localhost', {
    headers: { authorization: 'Bearer user-token' }
  })
  const query = {
    select: () => query,
    eq: () => query,
    single: () => Promise.resolve({ data: { guild_code: 'OTHER' } })
  }
  const response = await authorizeSolverGuildRequest(request, 'EOT', {
    createClient: () => ({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })
      },
      from: () => query
    })
  })

  assertEquals(response?.status, 403)
})

Deno.test('boss-assignment-solver - rejects a banned user JWT', async () => {
  const request = new Request('http://localhost', {
    headers: { authorization: 'Bearer user-token' }
  })
  const membershipQuery = {
    select: () => membershipQuery,
    eq: () => membershipQuery,
    single: () =>
      Promise.resolve({
        data: {
          guild_code: 'EOT',
          player_id: 'player-1',
          discord_user_id: 'discord-1'
        },
        error: null
      })
  }
  const banQuery = {
    select: () => banQuery,
    eq: () => banQuery,
    is: () => banQuery,
    or: () => banQuery,
    limit: () => Promise.resolve({ data: [{ id: 'ban-1' }], error: null })
  }
  const response = await authorizeSolverGuildRequest(request, 'EOT', {
    createClient: () => ({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: { id: 'user-1', email: 'user@example.com' } },
            error: null
          })
      },
      from: (table: string) =>
        table === 'player_mapping' ? membershipQuery : banQuery
    })
  })

  assertEquals(response?.status, 403)
  assertEquals((await response?.json())?.error, 'Account suspended')
})

Deno.test(
  'boss-assignment-solver - fails closed when the ban ledger is unavailable',
  async () => {
    const request = new Request('http://localhost', {
      headers: { authorization: 'Bearer user-token' }
    })
    const membershipQuery = {
      select: () => membershipQuery,
      eq: () => membershipQuery,
      single: () =>
        Promise.resolve({
          data: {
            guild_code: 'EOT',
            player_id: 'player-1',
            discord_user_id: null
          },
          error: null
        })
    }
    const banQuery = {
      select: () => banQuery,
      eq: () => banQuery,
      is: () => banQuery,
      or: () => banQuery,
      limit: () =>
        Promise.resolve({ data: null, error: { message: 'db unavailable' } })
    }
    const response = await authorizeSolverGuildRequest(request, 'EOT', {
      createClient: () => ({
        auth: {
          getUser: () =>
            Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })
        },
        from: (table: string) =>
          table === 'player_mapping' ? membershipQuery : banQuery
      })
    })

    assertEquals(response?.status, 503)
  }
)

Deno.test('boss-assignment-solver - accepts service-role callers', async () => {
  const previous = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-secret')
  try {
    const request = new Request('http://localhost', {
      headers: { authorization: 'Bearer service-secret' }
    })
    const response = await authorizeSolverGuildRequest(request, 'EOT', {
      createClient: () => {
        throw new Error('service calls must not resolve a user')
      }
    })
    assertEquals(response, null)
  } finally {
    if (previous === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previous)
  }
})
