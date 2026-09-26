import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RevokedKeyBanner } from '@/app/components/alerts/RevokedKeyBanner'
import type { OpenRevokedKeyIncident } from '@/app/lib/data/revoked-key-incident'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}))

const INCIDENT: OpenRevokedKeyIncident = {
  incidentId: 'GUILD1:2026-09-01T10:00:00.000Z',
  guildCode: 'GUILD1',
  guildDisplayName: 'First Company',
  keyOwnerDisplayName: 'Sergeant Key Holder',
  openedAt: '2026-09-01T10:00:00.000Z',
  viewerIsLeadership: false,
  hasDiscordContactChannel: false
}

describe('RevokedKeyBanner', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('shows the guild, the player whose key died, when, and the single CTA', () => {
    render(<RevokedKeyBanner incident={INCIDENT} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('First Company')
    expect(alert).toHaveTextContent('Sergeant Key Holder')
    expect(alert).toHaveTextContent('2026-09-01')

    const cta = screen.getByRole('link', { name: 'Re-add the API key' })
    expect(cta).toHaveAttribute('href', '/api-keys')
  })

  it('renders nothing when there is no open incident (negative control)', () => {
    const { container } = render(<RevokedKeyBanner incident={null} />)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('never renders the key itself, only the owner display name', () => {
    render(<RevokedKeyBanner incident={INCIDENT} />)

    expect(screen.getByRole('alert').textContent).not.toMatch(
      /api[_-]?key[:=]/i
    )
  })

  it('hides for the rest of the session once dismissed', () => {
    const { rerender } = render(<RevokedKeyBanner incident={INCIDENT} />)

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(<RevokedKeyBanner incident={null} />)
    rerender(<RevokedKeyBanner incident={INCIDENT} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('returns for a different incident id even inside the same session', () => {
    const { rerender } = render(<RevokedKeyBanner incident={INCIDENT} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(
      <RevokedKeyBanner
        incident={{
          ...INCIDENT,
          incidentId: 'GUILD1:2026-09-14T10:00:00.000Z',
          openedAt: '2026-09-14T10:00:00.000Z'
        }}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('2026-09-14')
  })

  it('disappears when the incident resolves and the accessor returns null', () => {
    const { rerender } = render(<RevokedKeyBanner incident={INCIDENT} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(<RevokedKeyBanner incident={null} />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('nudges an officer whose guild has no contact channel', () => {
    render(
      <RevokedKeyBanner incident={{ ...INCIDENT, viewerIsLeadership: true }} />
    )

    expect(
      screen.getByRole('link', { name: 'Add a contact channel' })
    ).toHaveAttribute('href', '/guild-management/settings?tab=integrations')
  })

  it('does not nudge an officer whose guild already has a webhook', () => {
    render(
      <RevokedKeyBanner
        incident={{
          ...INCIDENT,
          viewerIsLeadership: true,
          hasDiscordContactChannel: true
        }}
      />
    )

    expect(
      screen.queryByRole('link', { name: 'Add a contact channel' })
    ).toBeNull()
  })

  it('does not nudge an ordinary member', () => {
    render(<RevokedKeyBanner incident={INCIDENT} />)

    expect(
      screen.queryByRole('link', { name: 'Add a contact channel' })
    ).toBeNull()
  })
})
