import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TokenAvailability from '@/app/components/TokenAvailability'

const pushMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock })
}))

vi.mock('@tacticus/ui-kit', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  )
}))

vi.mock('lucide-react', () => ({
  Zap: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
  Clock: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
  Target: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
  Bomb: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
  Swords: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
  Key: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
  AlertCircle: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
  RefreshCw: ({ className }: { className?: string }) => (
    <span className={className} />
  )
}))

describe('TokenAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('prompts for API key when missing', () => {
    render(<TokenAvailability hasPlayerApiKey={false} />)

    expect(
      screen.getByText(
        'Connect your Player API key to view live token availability.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add API Key' }))
    expect(pushMock).toHaveBeenCalledWith('/api-keys')
  })

  it('shows error state when sync fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Sync failed' })
    })

    render(<TokenAvailability hasPlayerApiKey />)

    expect(await screen.findByText('Sync failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('renders nested API errors as text instead of object coercion', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({
          error: { message: 'Failed to decrypt API key', code: 5001 }
        })
    })

    render(<TokenAvailability hasPlayerApiKey />)

    expect(
      await screen.findByText('Failed to decrypt API key')
    ).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
  })

  it('renders token data and next timer after successful sync', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          tokenInfo: {
            tokensAvailable: 2,
            nextTokenSeconds: 600,
            arenaTokens: 10,
            nextArenaTokenSeconds: 300,
            bombsAvailable: 1,
            nextBombSeconds: null
          }
        })
    })

    render(<TokenAvailability hasPlayerApiKey />)

    expect(await screen.findByText('Guild Raid')).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('00:10')).toBeInTheDocument()
    expect(await screen.findByText(/Last synced:/)).toBeInTheDocument()
  })
})
