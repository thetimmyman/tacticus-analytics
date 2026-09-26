import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import InactiveHome from '@/app/(home)/home/InactiveHome'
import { resolveServerNavigationRole } from '@/app/components/navigation/server-role-authority'

describe('InactiveHome', () => {
  it('offers the three recovery routes with relink as the primary CTA', () => {
    render(<InactiveHome displayName="Former Leader" />)

    const relink = screen.getByRole('link', { name: /link my account/i })
    expect(relink).toHaveAttribute('href', '/onboarding/claim')
    expect(
      screen.getByRole('link', { name: /explore guilds/i })
    ).toHaveAttribute('href', '/explore')
    expect(screen.queryByRole('link', { name: /find a guild/i })).toBeNull()
    expect(
      screen.getByRole('heading', { name: /not on a current guild roster/i })
    ).toBeInTheDocument()
  })

  it('renders without a display name', () => {
    render(<InactiveHome />)
    expect(
      screen.getByRole('heading', { name: /^Your account is not on/i })
    ).toBeInTheDocument()
  })

  it('renders no session role or standing identity', () => {
    const { container } = render(<InactiveHome displayName="Commander" />)
    expect(container.textContent).not.toMatch(/\brank\b|\bdamage\b/i)
  })
})

describe('inactive session navigation gate', () => {
  it('resolves the scrubbed inactive session to workspace chrome', () => {
    const scrubbed = { id: 'user-1', role: 'member' as const }
    const effectiveRole = resolveServerNavigationRole(null, scrubbed)
    expect(effectiveRole).toBe('member')
    expect(!!scrubbed && effectiveRole !== 'onboarding').toBe(true)
  })
})
