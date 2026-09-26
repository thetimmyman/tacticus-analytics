import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingProgress } from '@tacticus/app-core/onboarding.types'
import OnboardingDashboardClient from '@/app/(public)/onboarding/dashboard/OnboardingDashboardClient'

/** Step 2 derives the guild from the carried key, so the carry must survive only its own flow. */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}))

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: vi.fn()
  })
}))

vi.mock('@/app/(public)/onboarding/dashboard/ClusterOnboardingCard', () => ({
  ClusterOnboardingCard: () => <div data-testid="cluster-card" />
}))

const GUILD_A = 'AAAAA'
const GUILD_B = 'BBBBB'
const KEY_A = 'tacticus-key-for-guild-a'

function progressFixture(
  overrides: Partial<OnboardingProgress> = {}
): OnboardingProgress {
  return {
    user_id: 'user-1',
    guild_mode: 'new_guild',
    role_intent: 'leader',
    guild_status: 'not_started',
    guild_code: null,
    guild_name: null,
    guild_error_message: null,
    guild_can_retry: true,
    guild_lock_expires_at: null,
    sync_status: 'pending',
    sync_progress: 0,
    sync_records_synced: 0,
    sync_error_message: null,
    sync_can_retry: true,
    profile_status: 'not_started',
    player_id: null,
    player_name: null,
    profile_error_message: null,
    profile_can_retry: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides
  }
}

let serverProgress: OnboardingProgress
let calls: Array<{ url: string; body: Record<string, unknown> }>

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response
}

/** Like the real route, `POST /api/onboarding/start` keeps `guild_code` after a completed registration. */
function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {}
      calls.push({ url, body })

      if (url === '/api/onboarding/start') {
        serverProgress = {
          ...serverProgress,
          guild_mode: body.guildMode as OnboardingProgress['guild_mode']
        }
        return jsonResponse({ progress: serverProgress })
      }

      if (url === '/api/onboarding/guild/start') {
        const guildCode = String(body.guildCode)
        serverProgress = {
          ...serverProgress,
          guild_mode: body.guildMode as OnboardingProgress['guild_mode'],
          role_intent: body.guildMode === 'new_guild' ? 'leader' : 'member',
          guild_status: 'complete',
          guild_code: guildCode,
          guild_name: (body.guildName as string) ?? guildCode,
          sync_status: 'pending'
        }
        return jsonResponse({ progress: serverProgress })
      }

      if (url === '/api/onboarding/data-sync/start') {
        return jsonResponse({
          progress: serverProgress,
          message: 'Sync started.'
        })
      }

      return jsonResponse({ progress: serverProgress })
    })
  )
}

function renderDashboard() {
  return render(
    <OnboardingDashboardClient
      user={{ id: 'user-1', email: 'leader@example.com', displayName: null }}
      initialProgress={serverProgress}
      initialSyncStatus={null}
      initialJob={null}
      initialCluster={null}
      initialClusterGuilds={[]}
    />
  )
}

async function registerNewGuild(
  user: ReturnType<typeof userEvent.setup>,
  guildCode: string,
  apiKey: string
) {
  await user.type(screen.getByLabelText('Guild code'), guildCode)
  await user.type(screen.getByLabelText('Guild name'), `Guild ${guildCode}`)
  await user.type(screen.getByLabelText('Guild leader API key'), apiKey)
  await user.click(screen.getByRole('button', { name: /register guild/i }))
  await waitFor(() =>
    expect(screen.getByText(/guild confirmed/i)).toBeInTheDocument()
  )
}

async function startSync(user: ReturnType<typeof userEvent.setup>) {
  const before = calls.filter(
    (call) => call.url === '/api/onboarding/data-sync/start'
  ).length
  await user.click(screen.getByRole('button', { name: /start data sync/i }))
  await waitFor(() =>
    expect(
      calls.filter((call) => call.url === '/api/onboarding/data-sync/start')
    ).toHaveLength(before + 1)
  )
  return calls.filter((call) => call.url === '/api/onboarding/data-sync/start')[
    before
  ].body
}

describe('onboarding Step 2 — which key the sync is allowed to spend', () => {
  beforeEach(() => {
    calls = []
    serverProgress = progressFixture()
    mockServer()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('spends the key just registered, with no retype, on the sync straight after', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await registerNewGuild(user, GUILD_A, KEY_A)

    expect(await startSync(user)).toEqual({ apiKey: KEY_A })
  })

  it('never spends guild A key on a sync for the guild joined afterwards', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await registerNewGuild(user, GUILD_A, KEY_A)

    await user.click(
      screen.getByRole('button', { name: /join existing guild/i })
    )
    await waitFor(() =>
      expect(serverProgress.guild_mode).toBe('existing_guild')
    )
    const guildCodeField = screen.getByLabelText('Guild code')
    await user.clear(guildCodeField)
    await user.type(guildCodeField, GUILD_B)
    await user.click(screen.getByRole('button', { name: /save guild/i }))
    await waitFor(() => expect(serverProgress.guild_code).toBe(GUILD_B))

    // No key beats the wrong key: a 409 prompt versus a cross-guild sync.
    expect(await startSync(user)).toEqual({})
  })

  it('stops carrying the key once the sync it was carried for has been accepted', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await registerNewGuild(user, GUILD_A, KEY_A)

    expect(await startSync(user)).toEqual({ apiKey: KEY_A })
    expect(await startSync(user)).toEqual({})
  })

  it('sends a key typed into the revealed field for the guild on screen', async () => {
    const user = userEvent.setup()
    serverProgress = progressFixture({
      guild_status: 'complete',
      guild_code: GUILD_B,
      guild_name: 'Guild B',
      guild_mode: 'existing_guild',
      role_intent: 'member'
    })
    renderDashboard()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          body: init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : {}
        })
        if (url === '/api/onboarding/data-sync/start') {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: {
                code: 'GUILD_ATTESTATION_REQUIRED',
                message: 'Confirm your guild API key.'
              }
            })
          } as unknown as Response
        }
        return jsonResponse({ progress: serverProgress })
      })
    )

    await startSync(user)

    const field = await screen.findByLabelText('Guild API key for sync')
    await user.type(field, 'typed-key-for-guild-b')
    expect(await startSync(user)).toEqual({ apiKey: 'typed-key-for-guild-b' })
  })
})
