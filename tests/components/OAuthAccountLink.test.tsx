import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OAuthAccountLink from '@/app/components/auth/OAuthAccountLink'

const mocks = vi.hoisted(() => ({
  dbClient: vi.fn()
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: mocks.dbClient
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  })
}))

describe('OAuthAccountLink Discord unlink', () => {
  let unlinkIdentity: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    unlinkIdentity = vi.fn().mockResolvedValue({ error: null })
    mocks.dbClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              identities: [
                {
                  id: 'identity-1',
                  provider: 'discord',
                  identity_data: {}
                }
              ]
            }
          }
        }),
        unlinkIdentity,
        linkIdentity: vi.fn(),
        updateUser: vi.fn()
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prepares DB denial before provider unlink and confirms afterward', async () => {
    const order: string[] = []
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        order.push(String(init?.method))
        return new Response(null, { status: 200 })
      })
    unlinkIdentity.mockImplementation(async () => {
      order.push('unlinkIdentity')
      return { error: null }
    })
    const onLinkChange = vi.fn()
    render(
      <OAuthAccountLink
        provider="discord"
        isLinked
        displayName="Discord User"
        onLinkChange={onLinkChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))

    await waitFor(() => expect(onLinkChange).toHaveBeenCalledWith(false))
    expect(order).toEqual(['DELETE', 'unlinkIdentity', 'PATCH'])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/auth/sync-discord',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/sync-discord',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('does not unlink the provider when DB preparation fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 })
    )
    render(
      <OAuthAccountLink
        provider="discord"
        isLinked
        displayName="Discord User"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))

    expect(
      await screen.findByText(
        'Could not safely prepare Discord unlink. No provider change was made.'
      )
    ).toBeInTheDocument()
    expect(unlinkIdentity).not.toHaveBeenCalled()
  })

  it('prepares a fresh Discord generation before starting link OAuth', async () => {
    const order: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      order.push(String(init?.method))
      return new Response(null, { status: 200 })
    })
    const client = mocks.dbClient()
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [] } }
    })
    client.auth.linkIdentity.mockImplementation(async () => {
      order.push('linkIdentity')
      return { error: null }
    })

    render(
      <OAuthAccountLink
        provider="discord"
        isLinked={false}
        displayName={null}
      />
    )
    fireEvent.click(
      await screen.findByRole('button', { name: /link discord/i })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: /continue to discord/i })
    )

    await waitFor(() => expect(client.auth.linkIdentity).toHaveBeenCalled())
    expect(order.slice(0, 2)).toEqual(['DELETE', 'linkIdentity'])
  })
})
