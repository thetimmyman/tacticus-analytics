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
  it('requires Player access for personal content', async () => {
    mount('/roster', { playerReady: false, guildReady: false })
    expect(
      await screen.findByText('Connect your Player API key')
    ).toBeInTheDocument()
    expect(screen.queryByText('Cached content')).not.toBeInTheDocument()
  })
  it('opens personal content and counters while keeping guild content in holding state', async () => {
    mount('/roster', {
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
