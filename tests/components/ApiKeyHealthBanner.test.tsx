import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ApiKeyHealthBanner } from '@/app/components/alerts/ApiKeyHealthBanner'

type GuildApiStatus = {
  api_key_is_valid: boolean | null
  api_key_last_validated: string | null
  api_key_encrypted: string | null
  consecutive_sync_failures: number | null
  last_sync_attempt: string | null
  last_successful_sync: string | null
}

let mockClusterContext = {
  role: 'member',
  guildCode: 'TEST',
  isLoading: false
}

let mockApiStatus: GuildApiStatus | null = null
let mockSupabaseError: unknown = null

const buildQuery = () => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      single: vi.fn(() =>
        Promise.resolve({ data: mockApiStatus, error: mockSupabaseError })
      )
    }))
  }))
})

const mockSupabase = {
  from: vi.fn(() => buildQuery())
}

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => mockSupabase)
}))

vi.mock('@/app/hooks/useClusterContext', () => ({
  useClusterContext: vi.fn(() => mockClusterContext)
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}))

vi.mock('@tacticus/ui-kit', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  )
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const baseStatus = (): GuildApiStatus => ({
  api_key_is_valid: true,
  api_key_last_validated: new Date().toISOString(),
  api_key_encrypted: 'encrypted',
  consecutive_sync_failures: 0,
  last_sync_attempt: null,
  last_successful_sync: null
})

describe('ApiKeyHealthBanner', () => {
  beforeEach(() => {
    mockClusterContext = { role: 'member', guildCode: 'TEST', isLoading: false }
    mockApiStatus = baseStatus()
    mockSupabaseError = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing while loading', () => {
    mockClusterContext = { role: 'member', guildCode: 'TEST', isLoading: true }
    const { container } = render(<ApiKeyHealthBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows banner when no API key is configured', async () => {
    mockApiStatus = {
      ...baseStatus(),
      api_key_encrypted: null,
      api_key_is_valid: null,
      api_key_last_validated: null
    }

    render(<ApiKeyHealthBanner />)

    expect(await screen.findByText('No API Key Configured')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /add api key/i })
    ).toBeInTheDocument()
  })

  it('shows invalid API key banner', async () => {
    mockApiStatus = {
      ...baseStatus(),
      api_key_is_valid: false,
      consecutive_sync_failures: 2
    }

    render(<ApiKeyHealthBanner />)

    expect(await screen.findByText('Invalid API Key')).toBeInTheDocument()
  })

  it('shows sync issues when failures are high', async () => {
    mockApiStatus = {
      ...baseStatus(),
      consecutive_sync_failures: 3
    }

    render(<ApiKeyHealthBanner />)

    expect(await screen.findByText('Sync Issues Detected')).toBeInTheDocument()
  })

  it('shows validation reminder for leaders with stale keys', async () => {
    mockClusterContext = { role: 'leader', guildCode: 'TEST', isLoading: false }
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000
    mockApiStatus = {
      ...baseStatus(),
      api_key_last_validated: new Date(thirtyOneDaysAgo).toISOString()
    }

    render(<ApiKeyHealthBanner />)

    expect(
      await screen.findByText('API Key Needs Validation')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /test now/i })
    ).toBeInTheDocument()
  })

  it('updates API key successfully', async () => {
    mockApiStatus = {
      ...baseStatus(),
      api_key_encrypted: null,
      api_key_is_valid: null,
      api_key_last_validated: null
    }
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({})
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<ApiKeyHealthBanner />)

    const addButton = await screen.findByRole('button', {
      name: /add api key/i
    })
    fireEvent.click(addButton)

    const input = await screen.findByPlaceholderText(
      /Paste Guild & Guild Raid Leader API key/i
    )
    fireEvent.change(input, { target: { value: 'NEW-KEY' } })

    const buttonRow = input.parentElement?.querySelectorAll('button')
    if (!buttonRow || buttonRow.length < 1) {
      throw new Error('Save button not found')
    }
    fireEvent.click(buttonRow[0])

    expect(
      await screen.findByText(/API key updated successfully/i)
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/guild/update-api-key',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
