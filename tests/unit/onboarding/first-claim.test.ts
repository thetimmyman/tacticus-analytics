import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { describe, expect, it, vi } from 'vitest'
import { isGuildAwaitingFirstClaim } from '@/app/lib/onboarding/first-claim'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

type Seat = {
  user_id: string | null
  role: string | null
  is_app_admin?: boolean | null
}

function createRosterClient(
  result: { data: Seat[] | null; error: { message: string } | null } | Error
) {
  const query = {
    select: vi.fn(),
    eq: vi.fn()
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValueOnce(query)
  if (result instanceof Error) {
    query.eq.mockRejectedValueOnce(result)
  } else {
    query.eq.mockResolvedValueOnce(result)
  }

  const client = {
    from: vi.fn(() => query)
  } as unknown as TypedSupabaseClient

  return { client, query }
}

function seats(...rows: Seat[]) {
  return { data: rows, error: null }
}

describe('isGuildAwaitingFirstClaim', () => {
  it('short-circuits without querying when there is no guild yet', async () => {
    const { client } = createRosterClient(seats())

    await expect(isGuildAwaitingFirstClaim(client, null)).resolves.toBe(false)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('is true for a synced roster with nobody linked', async () => {
    const { client, query } = createRosterClient(
      seats(
        { user_id: null, role: 'leader' },
        { user_id: null, role: 'member' }
      )
    )

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(true)
    expect(client.from).toHaveBeenCalledWith('player_mapping')
    expect(query.select).toHaveBeenCalledWith('user_id, role, is_app_admin')
    expect(query.eq).toHaveBeenCalledWith('guild_code', 'ZKFPH')
    expect(query.eq).toHaveBeenCalledWith('is_current', true)
  })

  it('is false once a leader seat is linked', async () => {
    const { client } = createRosterClient(
      seats(
        { user_id: 'u1', role: 'leader' },
        { user_id: null, role: 'member' }
      )
    )

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(
      false
    )
  })

  it('stays available to the verified registrar after another leader links', async () => {
    const rosterResult = seats(
      { user_id: 'other-leader', role: 'leader' },
      { user_id: null, role: 'officer' }
    )
    const rosterChain: Record<string, unknown> = {}
    for (const method of ['select', 'eq']) {
      rosterChain[method] = vi.fn(() => rosterChain)
    }
    rosterChain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(rosterResult).then(resolve)

    const receiptChain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'limit']) {
      receiptChain[method] = vi.fn(() => receiptChain)
    }
    receiptChain.maybeSingle = vi.fn(async () => ({
      data: { id: 42 },
      error: null
    }))

    const client = {
      from: vi.fn((table: string) =>
        table === 'player_mapping' ? rosterChain : receiptChain
      )
    } as unknown as TypedSupabaseClient

    await expect(
      isGuildAwaitingFirstClaim(client, 'ZKFPH', 'registrar-user')
    ).resolves.toBe(true)
    expect(client.from).toHaveBeenCalledWith('player_claim_audit')
  })

  // Without the RPC's `is_app_admin IS TRUE` check the widget shows where the mint fails.
  it('is false once a linked app admin holds any seat, whatever their role', async () => {
    const { client } = createRosterClient(
      seats(
        { user_id: 'admin-1', role: 'member', is_app_admin: true },
        { user_id: null, role: 'leader' }
      )
    )

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(
      false
    )
  })

  it('stays true for an UNLINKED app admin on the roster', async () => {
    const { client } = createRosterClient(
      seats({ user_id: null, role: 'member', is_app_admin: true })
    )

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(true)
  })

  it('is false once an officer seat is linked', async () => {
    const { client } = createRosterClient(
      seats({ user_id: 'u1', role: 'OFFICER' })
    )

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(
      false
    )
  })

  // A plain member cannot mint, so the corridor stays open (mirrors mint_bootstrap_seat_invite).
  it('stays true when the only linked seat is a plain member', async () => {
    const { client } = createRosterClient(
      seats(
        { user_id: 'u1', role: 'member' },
        { user_id: null, role: 'leader' }
      )
    )

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(true)
  })

  // Mirrors the RPC's `lower(role) IN (...)`, so the widget shows whenever the DB would bootstrap.
  it('compares the stored role case-insensitively, as the RPC does', async () => {
    const { client } = createRosterClient(
      seats({ user_id: 'u1', role: 'Leader' })
    )

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(
      false
    )
  })

  // No roster yet: offering the widget only burns a 10/hour attempt.
  it('is false for a guild whose roster has not synced yet', async () => {
    const { client } = createRosterClient(seats())

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(
      false
    )
  })

  // Fails closed: a blip must not offer the widget to every member everywhere.
  it('is false when the roster lookup errors', async () => {
    const { client } = createRosterClient({
      data: null,
      error: { message: 'lookup unavailable' }
    })

    await expect(isGuildAwaitingFirstClaim(client, 'ZKFPH')).resolves.toBe(
      false
    )
  })
})
