import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { GuildSyncStoppedBanner } from '@/app/components/alerts/GuildSyncStoppedBanner'
import type { OpenGuildSyncIncident } from '@/app/lib/data/guild-sync-incident'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}))

function incident(
  overrides: Partial<OpenGuildSyncIncident> = {}
): OpenGuildSyncIncident {
  return {
    incidentId: 'GUILD1:invalid_key:2030-01-08T12:00:00.000Z',
    reason: 'invalid_key',
    guildCode: 'GUILD1',
    guildDisplayName: 'First Company',
    keyOwnerDisplayName: 'Sergeant Key Holder',
    lastSuccessfulSyncAt: '2030-01-08T12:00:00.000Z',
    viewerIsLeadership: false,
    ...overrides
  }
}

describe('GuildSyncStoppedBanner', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('renders the invalid_key copy and links to the API key page', () => {
    render(<GuildSyncStoppedBanner incident={incident()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('First Company: data sync has stopped')
    expect(alert).toHaveTextContent('added by Sergeant Key Holder')
    expect(alert).toHaveTextContent('is no longer valid')
    expect(alert).toHaveTextContent('since 2030-01-08 12:00 UTC')

    const cta = screen.getByRole('link', { name: 'Fix the API key' })
    expect(cta).toHaveAttribute('href', '/api-keys')
  })

  it('renders the no_key copy and links to the API key page', () => {
    render(
      <GuildSyncStoppedBanner
        incident={incident({ reason: 'no_key', keyOwnerDisplayName: null })}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('First Company: data sync has stopped')
    expect(alert).toHaveTextContent('This guild has no Tacticus API key')
    expect(
      screen.getByRole('link', { name: 'Fix the API key' })
    ).toHaveAttribute('href', '/api-keys')
  })

  it('renders the auto_sync_off copy and links to the API key page', () => {
    render(
      <GuildSyncStoppedBanner
        incident={incident({
          reason: 'auto_sync_off',
          keyOwnerDisplayName: null
        })}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('First Company: data sync has stopped')
    expect(alert).toHaveTextContent(
      'Automatic sync is turned off for this guild'
    )
    expect(
      screen.getByRole('link', { name: 'Fix the API key' })
    ).toHaveAttribute('href', '/api-keys')
  })

  it('renders the stale copy and links to check the API key', () => {
    render(
      <GuildSyncStoppedBanner
        incident={incident({ reason: 'stale', keyOwnerDisplayName: null })}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('First Company: guild data is out of date')
    expect(alert).toHaveTextContent('No new data has synced since 2030-01-08')
    expect(alert).toHaveTextContent('Saving the key again')
    expect(alert).toHaveTextContent('the problem is not your key')
    expect(
      screen.getByRole('link', { name: 'Check the API key' })
    ).toHaveAttribute('href', '/api-keys')
  })

  it('renders nothing when there is no open incident', () => {
    const { container } = render(<GuildSyncStoppedBanner incident={null} />)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the date from lastSuccessfulSyncAt, never a validation timestamp', () => {
    render(
      <GuildSyncStoppedBanner
        incident={incident({
          lastSuccessfulSyncAt: '2030-01-02T00:00:00.000Z'
        })}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('2030-01-02')
  })

  it('never renders the key itself', () => {
    render(<GuildSyncStoppedBanner incident={incident()} />)

    expect(screen.getByRole('alert').textContent).not.toMatch(
      /api[_-]?key[:=]/i
    )
  })

  it('never mentions discord for any reason', () => {
    const reasons: OpenGuildSyncIncident['reason'][] = [
      'invalid_key',
      'no_key',
      'auto_sync_off',
      'stale'
    ]
    for (const reason of reasons) {
      const { unmount } = render(
        <GuildSyncStoppedBanner
          incident={incident({ reason, keyOwnerDisplayName: null })}
        />
      )
      expect(screen.getByRole('alert').textContent).not.toMatch(/discord/i)
      unmount()
    }
  })

  it('hides for the rest of the session once dismissed', () => {
    const { rerender } = render(
      <GuildSyncStoppedBanner incident={incident()} />
    )

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(<GuildSyncStoppedBanner incident={{ ...incident() }} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the same incident id again after the guild recovered in between', () => {
    const { rerender } = render(
      <GuildSyncStoppedBanner incident={incident()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(<GuildSyncStoppedBanner incident={null} />)
    rerender(<GuildSyncStoppedBanner incident={incident()} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('returns for a different incident id even inside the same session', () => {
    const { rerender } = render(
      <GuildSyncStoppedBanner incident={incident()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(
      <GuildSyncStoppedBanner
        incident={incident({
          incidentId: 'GUILD1:invalid_key:2030-01-14T12:00:00.000Z',
          lastSuccessfulSyncAt: '2030-01-14T12:00:00.000Z'
        })}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('2030-01-14')
  })

  it('shows the Guild Settings link to leadership and hides it from members', () => {
    const { rerender } = render(
      <GuildSyncStoppedBanner incident={incident()} />
    )
    expect(screen.queryByRole('link', { name: 'Guild Settings' })).toBeNull()

    rerender(
      <GuildSyncStoppedBanner
        incident={incident({ viewerIsLeadership: true })}
      />
    )
    expect(
      screen.getByRole('link', { name: 'Guild Settings' })
    ).toHaveAttribute('href', '/guild-management/settings?tab=integrations')
  })
})
