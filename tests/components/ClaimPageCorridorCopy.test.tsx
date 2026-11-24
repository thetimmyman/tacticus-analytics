import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClaimPage from '@/app/(public)/onboarding/claim/ClientPage'

const DIRECT_CLAIM_LINK = /Claim your seat with your API key/
const INVITE_ONLY_STEP = /Register New Guild/

const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams
}))

let authedUser: { id: string } | null = null

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: { getUser: async () => ({ data: { user: authedUser } }) },
    rpc: vi.fn()
  })
}))

function stubProgress(canSelfClaimSeat: boolean | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/onboarding/progress')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ canSelfClaimSeat })
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })
  )
}

describe('onboarding claim — direct Player-key claim pointer', () => {
  beforeEach(() => {
    authedUser = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers the direct claim only when this account can succeed at it', async () => {
    authedUser = { id: 'user-1' }
    stubProgress(true)

    render(<ClaimPage />)

    expect(
      await screen.findByRole('link', { name: DIRECT_CLAIM_LINK })
    ).toBeTruthy()
  })

  it('explains the custody step instead when the account lacks the receipt', async () => {
    authedUser = { id: 'user-1' }
    stubProgress(false)

    render(<ClaimPage />)

    await screen.findByText(INVITE_ONLY_STEP)
    expect(screen.queryByRole('link', { name: DIRECT_CLAIM_LINK })).toBeNull()
  })

  it('keeps a neutral dashboard pointer when signed out', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    render(<ClaimPage />)

    expect(
      await screen.findByRole('link', { name: /Open the onboarding dashboard/ })
    ).toBeTruthy()
    expect(screen.queryByRole('link', { name: DIRECT_CLAIM_LINK })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
