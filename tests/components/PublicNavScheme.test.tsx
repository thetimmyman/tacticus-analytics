import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    'aria-label': ariaLabel
  }: {
    children: React.ReactNode
    href: string
    className?: string
    'aria-label'?: string
  }) => (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  )
}))

vi.mock('@/app/components/icons/AnalyticsIcon', () => ({
  AnalyticsIcon: () => <div data-testid="eot-icon" />
}))

vi.mock('@/app/components/navigation/DiscordNavButton', () => ({
  DiscordNavButton: () => (
    <a
      href="https://discord.com/invite/tacticus"
      aria-label="Join our Discord server"
      data-testid="discord-nav-button"
    />
  )
}))

import { PublicNav } from '@/app/components/navigation/PublicNav'
import { getContrastRatio } from '@/app/lib/utils/contrast'

/**
 * The bar paints an opaque black surface, so it opts into `scheme-dark`
 * and fixed light tiers: Light Mode and guild themes repaint the theme
 * tokens it used to read from, collapsing Logo/Join/Explore to 1.2-3.1:1.
 */

const tokensOf = (el: Element) =>
  (el.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean)

const isThemeText = (token: string) =>
  token.startsWith('text-') &&
  (token.includes('(--') || token.includes('var(') || token.endsWith('-wh40k'))

const isCtaLink = (el: Element) =>
  tokensOf(el).some((token) => token.startsWith('from-(--cta-'))

const clusterWith = (container: HTMLElement, ...wanted: string[]) =>
  [...container.querySelectorAll('div')].find((el) => {
    const tokens = tokensOf(el)
    return wanted.every((token) => tokens.includes(token))
  }) as HTMLElement | undefined

describe('PublicNav: a readable dark island on every page theme', () => {
  it('scopes the header to an opaque black surface with the dark scheme', () => {
    render(<PublicNav />)

    const nav = screen.getByRole('navigation')
    const tokens = tokensOf(nav)
    expect(tokens).toContain('scheme-dark')
    expect(tokens).toContain('bg-black')
    expect(tokens.filter((token) => /^bg-\S+\/\d+$/u.test(token))).toEqual([])
    expect(tokens.filter((token) => token.includes('(--'))).toEqual([])
  })

  it('paints every label in a fixed light tier, never a theme token', () => {
    const { container } = render(<PublicNav />)

    expect(getContrastRatio('#ffffff', '#000000')).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio('#e5e7eb', '#000000')).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio('#f3f4f6', '#000000')).toBeGreaterThanOrEqual(4.5)

    expect(tokensOf(screen.getByText('Tacticus Analytics'))).toContain(
      'text-white'
    )
    for (const link of screen.getAllByRole('link', { name: 'Explore' })) {
      expect(tokensOf(link)).toContain('text-gray-200')
    }
    for (const link of screen.getAllByRole('link', { name: 'Join' })) {
      expect(tokensOf(link)).toContain('text-gray-100')
      expect(tokensOf(link)).toContain('bg-white/10')
    }

    const labelled = [...container.querySelectorAll('[class]')].filter(
      (el) => !isCtaLink(el)
    )
    for (const el of labelled) {
      expect(tokensOf(el).filter(isThemeText), el.className).toEqual([])
    }
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('keeps Login on the theme-safe sRGB CTA gradient', () => {
    render(<PublicNav />)

    const logins = screen.getAllByRole('link', { name: 'Login' })
    expect(logins).toHaveLength(2)
    for (const login of logins) {
      const tokens = tokensOf(login)
      expect(tokens).toContain('from-(--cta-from)')
      expect(tokens).toContain('to-(--cta-to)')
      expect(tokens).toContain('text-on-cta-wh40k')
      expect(tokens.some((token) => token.includes('/srgb'))).toBe(true)
    }
  })

  it('exposes an Explore link on mobile without crowding the row', () => {
    const { container } = render(<PublicNav />)

    const mobileCluster = clusterWith(container, 'flex', 'md:hidden')
    expect(mobileCluster).toBeDefined()
    const mobile = mobileCluster as HTMLElement

    const explore = mobile.querySelector('a[href="/explore"]')
    expect(explore).not.toBeNull()
    expect(explore?.textContent).toBe('Explore')
    expect(tokensOf(explore as Element)).toContain('text-xs')
    expect(mobile.querySelectorAll('a')).toHaveLength(3)

    // Icon-only wordmark below sm keeps three controls inside 320px.
    const wordmark = screen.getByText('Tacticus Analytics')
    expect(tokensOf(wordmark)).toContain('hidden')
    expect(tokensOf(wordmark)).toContain('sm:inline')

    const desktopCluster = clusterWith(container, 'hidden', 'md:flex')
    expect(
      (desktopCluster as HTMLElement).querySelector('a[href="/explore"]')
    ).not.toBeNull()
    expect(screen.getAllByRole('link', { name: 'Explore' })).toHaveLength(2)
  })

  it('keeps the home link reachable by name when the wordmark hides', () => {
    render(<PublicNav />)

    const home = screen.getByRole('link', { name: 'Tacticus Analytics' })
    expect(home).toHaveAttribute('href', '/')
    expect(home).toHaveAttribute('aria-label', 'Tacticus Analytics')
  })
})
