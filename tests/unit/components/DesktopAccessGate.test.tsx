import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DesktopAccessGate from '@/app/components/dashboard/DesktopAccessGate'

const route = vi.hoisted(() => ({ path: '/roster' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.path }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function mount(path: string, access: object) {
  route.path = path
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(access)))
  )
  render(
    <DesktopAccessGate>
      <p>Cached content</p>
    </DesktopAccessGate>
  )
}
describe('desktop API access holding states', () => {
  it.each(['/token-usage', '/boss-assignments/targets'])(
    'opens saved raid management at %s without live API capabilities',
    async (path) => {
      mount(path, { playerReady: false, guildReady: false })
      expect(await screen.findByText('Cached content')).toBeInTheDocument()
      expect(
        screen.queryByText('Connect your Player API key')
      ).not.toBeInTheDocument()
    }
  )
  it('opens saved roster team comparison without live Player or Guild access', async () => {
    mount('/guild-teams', { playerReady: false, guildReady: false })
    expect(await screen.findByText('Cached content')).toBeInTheDocument()
    expect(
      screen.queryByText('Connect your Player API key')
    ).not.toBeInTheDocument()
  })
  it('opens cached roster without Player access and retains live capability gates elsewhere', async () => {
    mount('/roster', { playerReady: false, guildReady: false })
    expect(await screen.findByText('Cached content')).toBeInTheDocument()
    cleanup()
    mount('/achievements', { playerReady: false, guildReady: false })
    expect(
      await screen.findByText('Connect your Player API key')
    ).toBeInTheDocument()
    expect(screen.queryByText('Cached content')).not.toBeInTheDocument()
  })
  it('opens personal content and counters while keeping guild content in holding state', async () => {
    mount('/achievements', {
      playerReady: true,
      guildReady: false,
      tokens: 2,
      bombs: 1
    })
    expect(await screen.findByText('Cached content')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Saved raid tokens: 2 · Saved bombs: 1'
    )
    cleanup()
    mount('/player-performance', { playerReady: true, guildReady: false })
    expect(
      await screen.findByText('Add Guild and Guild Raid access')
    ).toBeInTheDocument()
    expect(screen.queryByText('Cached content')).not.toBeInTheDocument()
  })
  it('opens guild content with both scopes and leaves recovery controls reachable', async () => {
    mount('/player-performance', { playerReady: true, guildReady: true })
    expect(await screen.findByText('Cached content')).toBeInTheDocument()
    cleanup()
    mount('/profile/change-password', { playerReady: false, guildReady: false })
    expect(screen.getByText('Cached content')).toBeInTheDocument()
  })
})
