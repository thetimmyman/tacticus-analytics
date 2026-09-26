import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClaimPage from '@/app/(public)/onboarding/claim/ClientPage'

const rpc = vi.fn()
const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: (...args: unknown[]) => rpc(...args)
  })
}))

const LIVE_CODE = 'A1B2C3D4E5F6'

async function inviteInput() {
  return (await screen.findByLabelText('Invite code')) as HTMLInputElement
}

describe('onboarding claim — invite code entry', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: { valid: false, error: 'x' }, error: null })
  })

  it('accepts a full 12-character code without truncating it', async () => {
    const user = userEvent.setup()
    render(<ClaimPage />)

    await user.type(await inviteInput(), LIVE_CODE)

    expect((await inviteInput()).value).toBe(LIVE_CODE)
  })

  it('sends the whole code to the lookup RPC', async () => {
    const user = userEvent.setup()
    render(<ClaimPage />)

    await user.type(await inviteInput(), LIVE_CODE)
    await user.click(screen.getByRole('button', { name: /verify/i }))

    expect(rpc).toHaveBeenCalledWith('get_invite_code_info', {
      p_code: LIVE_CODE
    })
  })

  it('does not cap input at the exact code length, so a padded paste survives', async () => {
    const user = userEvent.setup()
    render(<ClaimPage />)

    // maxLength truncates before onChange trims pasted whitespace.
    await user.click(await inviteInput())
    await user.paste(`  ${LIVE_CODE} `)

    expect((await inviteInput()).value).toBe(LIVE_CODE)
  })

  it('normalizes case and whitespace before lookup', async () => {
    const user = userEvent.setup()
    render(<ClaimPage />)

    await user.click(await inviteInput())
    await user.paste('a1b2 c3d4 e5f6')
    await user.click(screen.getByRole('button', { name: /verify/i }))

    expect(rpc).toHaveBeenCalledWith('get_invite_code_info', {
      p_code: LIVE_CODE
    })
  })
})
