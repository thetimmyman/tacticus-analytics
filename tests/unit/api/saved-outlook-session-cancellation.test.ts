import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { PostgrestClient } from '@supabase/postgrest-js'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { Errors } from '@/app/lib/errors/AppError'

const { serviceDb } = vi.hoisted(() => ({ serviceDb: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ serviceDb }))
vi.unmock('@/app/lib/auth/user-bans')

beforeEach(() => vi.clearAllMocks())

const user = {
  id: '00000000-0000-4000-8000-000000000101',
  email: 'synthetic@localhost.invalid'
} as User
const signedClient = () =>
  ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null })
    }
  }) as unknown as Pick<SupabaseClient, 'auth'>

function banTransport(
  options: { stall?: 'player_mapping' | 'user_bans'; banned?: boolean } = {}
) {
  const requests: { table: string; signal?: AbortSignal | null }[] = []
  const transport: typeof fetch = async (input, init) => {
    const table = new URL(String(input)).pathname.split('/').at(-1)!
    requests.push({ table, signal: init?.signal })
    if (table === options.stall) {
      return new Promise((_, reject) => {
        const rejectAbort = () => reject(init?.signal?.reason)
        if (init?.signal?.aborted) rejectAbort()
        else
          init?.signal?.addEventListener('abort', rejectAbort, { once: true })
      })
    }
    if (!['player_mapping', 'user_bans'].includes(table))
      throw new Error('Unexpected authentication relation')
    const data =
      table === 'user_bans' && options.banned
        ? [
            {
              id: 'synthetic-ban',
              ban_group_id: 'synthetic-group',
              auth_user_id: user.id,
              subject_type: 'user_id',
              subject_value: user.id,
              reason: 'Synthetic suspension',
              banned_at: '2026-01-01T00:00:00Z',
              expires_at: null
            }
          ]
        : []
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const client = new PostgrestClient('http://localhost/rest/v1', {
    fetch: transport
  })
  serviceDb.mockReturnValue(client)
  return requests
}

it('does not begin authentication or ban reads for an already canceled request', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Synthetic cancellation'))
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: null }, error: null })
  const client = { auth: { getUser } } as unknown as Pick<
    SupabaseClient,
    'auth'
  >
  await expect(
    requireSessionUser(client, () => Errors.unauthorized(), controller.signal)
  ).rejects.toThrow('Synthetic cancellation')
  expect(getUser).not.toHaveBeenCalled()
  expect(serviceDb).not.toHaveBeenCalled()
})

it('does not start ban lookup when an outstanding authentication result arrives after cancellation', async () => {
  const controller = new AbortController()
  let settle!: (result: { data: { user: User }; error: null }) => void
  const authResult = new Promise<{ data: { user: User }; error: null }>(
    (resolve) => {
      settle = resolve
    }
  )
  const client = {
    auth: { getUser: vi.fn().mockReturnValue(authResult) }
  } as unknown as Pick<SupabaseClient, 'auth'>
  const pending = requireSessionUser(
    client,
    () => Errors.unauthorized(),
    controller.signal
  )
  controller.abort(new Error('Synthetic cancellation'))
  settle({ data: { user }, error: null })
  await expect(pending).rejects.toThrow('Synthetic cancellation')
  expect(serviceDb).not.toHaveBeenCalled()
})

it.each(['player_mapping', 'user_bans'] as const)(
  'cancels %s and does not issue subsequent ban reads',
  async (stall) => {
    const controller = new AbortController()
    const requests = banTransport({ stall })
    const pending = requireSessionUser(
      signedClient(),
      () => Errors.unauthorized(),
      controller.signal
    )
    const rejection = expect(pending).rejects.toThrow('Synthetic cancellation')
    await vi.waitFor(() => expect(requests.at(-1)?.table).toBe(stall))
    controller.abort(new Error('Synthetic cancellation'))
    await rejection
    expect(requests.map((request) => request.table)).toEqual(
      stall === 'player_mapping'
        ? ['player_mapping']
        : ['player_mapping', 'user_bans']
    )
    expect(
      requests.every((request) => request.signal === controller.signal)
    ).toBe(true)
    expect(serviceDb).toHaveBeenCalledWith(controller.signal)
  }
)

it('retains the real canonical suspension check with a cancellation signal', async () => {
  const controller = new AbortController()
  const requests = banTransport({ banned: true })
  await expect(
    requireSessionUser(
      signedClient(),
      () => Errors.unauthorized(),
      controller.signal
    )
  ).rejects.toMatchObject({ statusCode: 403, message: 'Account suspended' })
  expect(requests.map((request) => request.table)).toEqual([
    'player_mapping',
    'user_bans'
  ])
})

it('retains all canonical identity and subject ban reads for an allowed caller', async () => {
  const controller = new AbortController()
  const requests = banTransport()
  await expect(
    requireSessionUser(
      signedClient(),
      () => Errors.unauthorized(),
      controller.signal
    )
  ).resolves.toBe(user)
  expect(requests.map((request) => request.table)).toEqual([
    'player_mapping',
    'user_bans',
    'user_bans'
  ])
  expect(
    requests.every((request) => request.signal === controller.signal)
  ).toBe(true)
})
