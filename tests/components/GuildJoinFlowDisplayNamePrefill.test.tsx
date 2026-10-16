import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuildJoinFlow from '@/app/components/clusters/GuildJoinFlow'

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })
}))

const API_KEY = 'k'.repeat(24)

type FetchCall = { url: string; body: unknown }

function stubFetch(guildName: string | undefined) {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, body })
      let payload: unknown = {}
      if (url.startsWith('/api/clusters/join?')) {
        payload = {
          valid: true,
          cluster: {
            cluster_code: 'CLU',
            display_name: 'Test Cluster',
            max_guilds: 5
          }
        }
      } else if (url === '/api/validate-api-key') {
        payload = {
          valid: true,
          details: { guildInfo: { guildId: 'guild-id-1', guildName } }
        }
      } else if (url === '/api/clusters/join') {
        payload = {
          success: true,
          action: 'guild_created',
          guild: { guild_code: 'MYGUILD', display_name: guildName ?? 'Typed' }
        }
      }
      return { ok: true, status: 200, json: async () => payload } as Response
    })
  )
  return calls
}

async function openGuildForm(user: ReturnType<typeof userEvent.setup>) {
  render(<GuildJoinFlow />)
  await user.type(
    screen.getByPlaceholderText('Enter your invite code'),
    'abcdef'
  )
  await user.click(screen.getByRole('button', { name: /validate code/i }))
  await screen.findByText(/joining: test cluster/i)
  await user.type(screen.getByPlaceholderText('YOUR_GUILD'), 'myguild')
}

const displayNameInput = () =>
  screen.getByPlaceholderText(/guild name/i) as HTMLInputElement

async function enterApiKey(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText('For immediate sync setup'),
    API_KEY
  )
  await user.tab()
}

describe('GuildJoinFlow — display name from the in-game guild name', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('fills a blank display name from the API key', async () => {
    const calls = stubFetch('Synthetic Legion')
    const user = userEvent.setup()
    await openGuildForm(user)

    await enterApiKey(user)

    await waitFor(() =>
      expect(displayNameInput().value).toBe('Synthetic Legion')
    )
    expect(calls).toContainEqual({
      url: '/api/validate-api-key',
      body: { apiKey: API_KEY }
    })
    expect(
      screen.getByText(/filled in from your in-game guild name/i)
    ).toBeInTheDocument()
  })

  it('keeps a display name the leader already typed', async () => {
    stubFetch('Synthetic Legion')
    const user = userEvent.setup()
    await openGuildForm(user)
    await user.type(displayNameInput(), '[[XX] Mine')

    await enterApiKey(user)

    expect(displayNameInput().value).toBe('[XX] Mine')
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/validate-api-key',
      expect.anything()
    )
  })

  it('lets the leader edit the filled name before joining', async () => {
    const calls = stubFetch('Synthetic Legion')
    const user = userEvent.setup()
    await openGuildForm(user)
    await enterApiKey(user)
    await waitFor(() =>
      expect(displayNameInput().value).toBe('Synthetic Legion')
    )

    await user.click(displayNameInput())
    await user.keyboard('{Home}[[XX] ')
    await user.click(screen.getByRole('button', { name: /join cluster/i }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/clusters/join',
        body: expect.objectContaining({
          guildData: expect.objectContaining({
            displayName: '[XX] Synthetic Legion'
          })
        })
      })
    )
  })

  it('allows joining with a blank name when an API key is given', async () => {
    const calls = stubFetch(undefined)
    const user = userEvent.setup()
    await openGuildForm(user)
    await enterApiKey(user)

    await user.click(screen.getByRole('button', { name: /join cluster/i }))

    await waitFor(() =>
      expect(calls.some((call) => call.url === '/api/clusters/join')).toBe(true)
    )
  })

  it('still requires a display name when no API key is given', async () => {
    const calls = stubFetch('Synthetic Legion')
    const user = userEvent.setup()
    await openGuildForm(user)

    await user.click(screen.getByRole('button', { name: /join cluster/i }))

    expect(
      await screen.findByText(/display name is required/i)
    ).toBeInTheDocument()
    expect(calls.some((call) => call.url === '/api/clusters/join')).toBe(false)
  })
})
