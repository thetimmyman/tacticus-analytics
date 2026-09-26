/** Carousel wiring is also asserted at the real call site: a reimplementing harness cannot catch it. */

import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'

const embla = vi.hoisted(() => ({
  selectedSnap: 0,
  handlers: new Map<string, Set<() => void>>()
}))

function emitEmbla(event: string) {
  for (const handler of embla.handlers.get(event) ?? []) handler()
}

const mockEmblaRef = vi.fn()
const mockEmblaApi = {
  scrollPrev: vi.fn(),
  scrollNext: vi.fn(),
  scrollTo: vi.fn(),
  plugins: vi.fn(() => ({ autoplay: { play: vi.fn(), stop: vi.fn() } })),
  selectedScrollSnap: vi.fn(() => embla.selectedSnap),
  on: vi.fn((event: string, handler: () => void) => {
    const set = embla.handlers.get(event) ?? new Set<() => void>()
    set.add(handler)
    embla.handlers.set(event, set)
    return mockEmblaApi
  }),
  off: vi.fn((event: string, handler: () => void) => {
    embla.handlers.get(event)?.delete(handler)
    return mockEmblaApi
  })
}

// AnnouncementSlot puts role/aria on the slide's <Link>.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

vi.mock('embla-carousel-react', () => ({
  default: () => [mockEmblaRef, mockEmblaApi]
}))

vi.mock('embla-carousel-autoplay', () => ({
  default: vi.fn(() => ({}))
}))

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: nav.push }),
  usePathname: () => '/home'
}))

vi.mock('@/app/components/TokenAvailabilityWithBoundary', () => ({
  default: () => null
}))
vi.mock('@/app/components/briefing/YourNextMoveCard', () => ({
  default: () => null
}))
vi.mock('@/app/components/briefing/SeasonOutlookCard', () => ({
  default: () => null
}))
vi.mock('@/app/components/briefing/officer/OfficerBriefing', () => ({
  default: () => <div>Officer briefing body</div>
}))

vi.mock('@/app/components/playerstats/hooks/usePlayerStatsController', () => ({
  usePlayerStatsController: () => ({
    state: {
      searchTerm: '',
      selection: { player: '', season: '106', guild: 'EOT_GR' },
      stats: null,
      tokens: null,
      supabaseError: null,
      status: 'idle',
      context: null,
      playerMapping: null,
      availablePlayers: []
    },
    setSearchTerm: vi.fn(),
    selectPlayer: vi.fn(),
    fetchPlayerStats: vi.fn(),
    clusterCode: 'EOT'
  })
}))
vi.mock('@/app/lib/hooks/useGuildDisplayLabel', () => ({
  useGuildDisplayLabel: () => 'Example Alliance'
}))
vi.mock('@/app/lib/hooks/usePerformanceOptimized', () => ({
  usePlayerSearchOptimized: () => []
}))
vi.mock('@/app/components/PlayerBattleLog', () => ({ default: () => null }))
vi.mock('@/app/components/playerstats/PlayerStatsDisplay', () => ({
  PlayerStatsDisplay: () => null
}))

import type { NewsItem } from '@/app/components/landing/NewsBanner'
import AnnouncementSlot from '@/app/components/briefing/AnnouncementSlot'
import BriefingPage from '@/app/components/briefing/BriefingPage'
import { PlayerStatsPage } from '@/app/components/playerstats/PlayerStatsPage'
import { TokenAlertNudgeCard } from '@/app/components/token-usage/TokenAlertNudgeCard'
import {
  useTokenAlertNudge,
  TOKEN_ALERT_NUDGE_DISMISSAL_KEY
} from '@/app/components/token-usage/hooks/useTokenAlertNudge'
import {
  TOKEN_ALERT_NUDGE_ID,
  TOKEN_ALERT_NUDGE_TITLE,
  buildTokenAlertNewsItem,
  tokenAlertNudgeHref,
  withTokenAlertSlide
} from '@/app/components/token-usage/token-alert-nudge-content'

const DISMISSAL_KEY = 'wi4000:token-alert-nudge-dismissed-v2'

const ALL_OFF = {
  alert_on_full: false,
  alert_before_full: false,
  alert_before_full_minutes: 120,
  alert_on_token_gained: false
}

const ELIGIBLE_LINKED = {
  available: true,
  linked: true,
  dmBlocked: false,
  prefs: ALL_OFF
}

const ELIGIBLE_UNLINKED = {
  available: true,
  linked: false,
  dmBlocked: false,
  prefs: ALL_OFF
}

const OPTED_IN = {
  available: true,
  linked: true,
  dmBlocked: false,
  prefs: { ...ALL_OFF, alert_before_full: true }
}

const DM_BLOCKED = {
  available: true,
  linked: true,
  dmBlocked: true,
  prefs: ALL_OFF
}

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  }) as Promise<Response>
}

/** Waiting for the call alone returns before json() and the state commit, so negatives would pass vacuously. */
async function settleNudgeFetch() {
  await waitFor(() => {
    expect(globalThis.fetch).toHaveBeenCalled()
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function stubGet(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => jsonResponse(status, body))
  )
}

const ADMIN_ITEM: NewsItem = {
  id: 'admin-1',
  type: 'announcement',
  title: 'Season 106 starts Friday',
  description: 'Clear your tokens before reset'
}

function CarouselHarness({ items }: { items?: NewsItem[] }) {
  const nudge = useTokenAlertNudge()
  const announcements = withTokenAlertSlide(items, nudge)
  if (announcements.length === 0) return null
  return <AnnouncementSlot items={announcements} />
}

const BRIEFING_PROPS = {
  profile: { role: 'member' as const, guild_code: 'EOT_GR' },
  forecast: null
}

/** setup.vitest.ts stubs localStorage inertly; the dismissal needs a real one. */
const localStorageBacking = new Map<string, string>()

function installLocalStorageBacking() {
  const store = window.localStorage as unknown as {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
  }
  if (typeof store.getItem?.mockImplementation !== 'function') return
  store.getItem.mockImplementation(
    (key: string) => localStorageBacking.get(key) ?? null
  )
  store.setItem.mockImplementation((key: string, value: string) => {
    localStorageBacking.set(key, String(value))
  })
  store.removeItem.mockImplementation((key: string) => {
    localStorageBacking.delete(key)
  })
  store.clear.mockImplementation(() => localStorageBacking.clear())
}

beforeEach(() => {
  localStorageBacking.clear()
  installLocalStorageBacking()
  embla.selectedSnap = 0
  embla.handlers.clear()
  mockEmblaApi.on.mockClear()
  mockEmblaApi.off.mockClear()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  )
  nav.params = new URLSearchParams()
  nav.push.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('useTokenAlertNudge', () => {
  it('is not eligible when the feature is unavailable', async () => {
    stubGet({ available: false })

    const { result } = renderHook(() => useTokenAlertNudge())

    await waitFor(() => {
      expect(result.current.eligible).toBe(false)
    })
  })

  it('is not eligible when an alert toggle is already enabled', async () => {
    stubGet(OPTED_IN)

    const { result } = renderHook(() => useTokenAlertNudge())

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user/token-alerts')
    })
    await waitFor(() => {
      expect(result.current.eligible).toBe(false)
    })
  })

  it.each([
    ['alert_on_full', { ...ALL_OFF, alert_on_full: true }],
    ['alert_before_full', { ...ALL_OFF, alert_before_full: true }],
    ['alert_on_token_gained', { ...ALL_OFF, alert_on_token_gained: true }]
  ])('is not eligible when %s alone is enabled', async (_label, prefs) => {
    stubGet({ available: true, linked: true, dmBlocked: false, prefs })

    const { result } = renderHook(() => useTokenAlertNudge())

    await settleNudgeFetch()
    expect(result.current.eligible).toBe(false)
  })

  it('is not eligible when the response is not ok', async () => {
    stubGet(ELIGIBLE_LINKED, 500)

    const { result } = renderHook(() => useTokenAlertNudge())

    await settleNudgeFetch()
    expect(result.current.eligible).toBe(false)
  })

  it('is not eligible and does not throw when the fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() => Promise.reject(new Error('network down')))
    )

    const { result } = renderHook(() => useTokenAlertNudge())

    await settleNudgeFetch()
    expect(result.current.eligible).toBe(false)
  })

  it('is not eligible when the member has DMs blocked', async () => {
    stubGet(DM_BLOCKED)

    const { result } = renderHook(() => useTokenAlertNudge())

    await settleNudgeFetch()
    expect(result.current.eligible).toBe(false)
  })

  it('is eligible and reports linked when every toggle is off', async () => {
    stubGet(ELIGIBLE_LINKED)

    const { result } = renderHook(() => useTokenAlertNudge())

    await waitFor(() => {
      expect(result.current.eligible).toBe(true)
    })
    expect(result.current.linked).toBe(true)
  })

  it('positive control: the shared settle point drains the post-fetch update', async () => {
    stubGet(ELIGIBLE_LINKED)

    const { result } = renderHook(() => useTokenAlertNudge())

    expect(result.current.linked).toBe(false)
    expect(result.current.eligible).toBe(false)

    await settleNudgeFetch()

    expect(result.current.linked).toBe(true)
    expect(result.current.eligible).toBe(true)
  })

  it('does no work and stays ineligible when disabled', async () => {
    window.localStorage.setItem(DISMISSAL_KEY, '1')
    stubGet(ELIGIBLE_LINKED)

    const { result } = renderHook(() => useTokenAlertNudge({ enabled: false }))

    await waitFor(() => {
      expect(result.current.eligible).toBe(false)
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(result.current.linked).toBe(false)
    expect(result.current.dismissed).toBe(false)
  })

  it('is eligible and reports unlinked for a member with no Discord account', async () => {
    stubGet(ELIGIBLE_UNLINKED)

    const { result } = renderHook(() => useTokenAlertNudge())

    await waitFor(() => {
      expect(result.current.eligible).toBe(true)
    })
    expect(result.current.linked).toBe(false)
  })

  it('reports dismissed when the shared key is already set', async () => {
    window.localStorage.setItem(DISMISSAL_KEY, '1')
    stubGet(ELIGIBLE_LINKED)

    const { result } = renderHook(() => useTokenAlertNudge())

    await waitFor(() => {
      expect(result.current.dismissed).toBe(true)
    })
  })

  it('persists the dismissal to localStorage, not sessionStorage', async () => {
    stubGet(ELIGIBLE_LINKED)

    const { result } = renderHook(() => useTokenAlertNudge())

    await waitFor(() => {
      expect(result.current.eligible).toBe(true)
    })

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.dismissed).toBe(true)
    expect(window.localStorage.getItem(DISMISSAL_KEY)).toBe('1')
    expect(window.sessionStorage.getItem(DISMISSAL_KEY)).toBeNull()
  })

  it('clears carried-over state when disabled on a live instance', async () => {
    window.localStorage.setItem(DISMISSAL_KEY, '1')
    stubGet(ELIGIBLE_LINKED)

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useTokenAlertNudge({ enabled }),
      { initialProps: { enabled: true } }
    )

    await waitFor(() => {
      expect(result.current.eligible).toBe(true)
    })
    expect(result.current.linked).toBe(true)
    expect(result.current.dismissed).toBe(true)

    rerender({ enabled: false })

    expect(result.current.eligible).toBe(false)
    expect(result.current.linked).toBe(false)
    expect(result.current.dismissed).toBe(false)
  })

  it('exports the flat key so both surfaces share one dismissal', () => {
    expect(TOKEN_ALERT_NUDGE_DISMISSAL_KEY).toBe(DISMISSAL_KEY)
  })
})

describe('token-alert-nudge-content', () => {
  it('sends a linked member to the profile settings page', () => {
    expect(tokenAlertNudgeHref(true)).toBe('/profile')
    expect(buildTokenAlertNewsItem(true).href).toBe('/profile')
  })

  it('sends an unlinked member to the Connected Accounts card, not /profile/edit', () => {
    expect(tokenAlertNudgeHref(false)).toBe('/profile#connected-accounts')
    expect(buildTokenAlertNewsItem(false).href).toBe(
      '/profile#connected-accounts'
    )
  })

  it('builds a stable feature-typed slide', () => {
    const item = buildTokenAlertNewsItem(true)
    expect(item.id).toBe(TOKEN_ALERT_NUDGE_ID)
    expect(item.type).toBe('feature')
    expect(item.title).toBe(TOKEN_ALERT_NUDGE_TITLE)
  })

  it('appends the slide AFTER admin items so they keep slide 1', () => {
    const merged = withTokenAlertSlide([ADMIN_ITEM], {
      eligible: true,
      linked: true,
      dismissed: false
    })
    // Time-sensitive admin announcements must never sit behind the nudge's autoplay delay.
    expect(merged.map((i) => i.id)).toEqual(['admin-1', TOKEN_ALERT_NUDGE_ID])
  })

  it('returns the admin items untouched when not eligible', () => {
    const merged = withTokenAlertSlide([ADMIN_ITEM], {
      eligible: false,
      linked: true,
      dismissed: false
    })
    expect(merged).toEqual([ADMIN_ITEM])
  })

  it('drops the slide when dismissed, even while still eligible', () => {
    const merged = withTokenAlertSlide([ADMIN_ITEM], {
      eligible: true,
      linked: true,
      dismissed: true
    })
    expect(merged).toEqual([ADMIN_ITEM])
  })

  it('yields a one-item list when eligible and there are no admin items', () => {
    expect(
      withTokenAlertSlide(undefined, {
        eligible: true,
        linked: false,
        dismissed: false
      })
    ).toHaveLength(1)
  })

  it('yields an empty list when not eligible and there are no admin items', () => {
    expect(
      withTokenAlertSlide(undefined, {
        eligible: false,
        linked: false,
        dismissed: false
      })
    ).toEqual([])
  })
})

describe('homepage carousel wiring', () => {
  it('renders the rail from the nudge alone when there are no admin items', async () => {
    stubGet(ELIGIBLE_UNLINKED)

    render(<CarouselHarness />)

    expect(await screen.findByText(TOKEN_ALERT_NUDGE_TITLE)).toBeInTheDocument()
    expect(screen.getByText('New feature')).toBeInTheDocument()
    expect(
      screen.getByText('Link Discord to enable token alerts')
    ).toBeInTheDocument()
    // role="group" overrides the anchor's link role.
    expect(screen.getByRole('group')).toHaveAttribute(
      'href',
      '/profile#connected-accounts'
    )
  })

  it('shows the linked copy for a member who already connected Discord', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(<CarouselHarness />)

    expect(await screen.findByText(TOKEN_ALERT_NUDGE_TITLE)).toBeInTheDocument()
    expect(
      screen.getByText('Turn on token alerts in your profile')
    ).toBeInTheDocument()
    expect(screen.getByRole('group')).toHaveAttribute('href', '/profile')
  })

  it('does not render the nudge slide for an opted-in member', async () => {
    stubGet(OPTED_IN)

    render(<CarouselHarness items={[ADMIN_ITEM]} />)

    expect(
      await screen.findByText('Season 106 starts Friday')
    ).toBeInTheDocument()
    expect(screen.queryByText(TOKEN_ALERT_NUDGE_TITLE)).not.toBeInTheDocument()
  })

  it('renders nothing at all for an opted-in member with no admin items', async () => {
    stubGet(OPTED_IN)

    const { container } = render(<CarouselHarness />)

    await settleNudgeFetch()
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent when the card was already dismissed', async () => {
    window.localStorage.setItem(DISMISSAL_KEY, '1')
    stubGet(ELIGIBLE_LINKED)

    render(<CarouselHarness items={[ADMIN_ITEM]} />)

    await settleNudgeFetch()
    expect(screen.queryByText(TOKEN_ALERT_NUDGE_TITLE)).not.toBeInTheDocument()
    expect(screen.getByText('Season 106 starts Friday')).toBeInTheDocument()
  })
})

describe('AnnouncementSlot dismiss control', () => {
  const LINKED_ADMIN_ITEM: NewsItem = { ...ADMIN_ITEM, href: '/announcements' }

  it('renders no dismiss control when the caller passes no handler', () => {
    render(<AnnouncementSlot items={[LINKED_ADMIN_ITEM]} />)

    expect(
      screen.queryByRole('button', { name: /^Dismiss:/ })
    ).not.toBeInTheDocument()
  })

  it('renders no dismiss control for slides that did not opt in', () => {
    render(
      <AnnouncementSlot
        items={[LINKED_ADMIN_ITEM]}
        dismissibleIds={['some-other-id']}
        onDismissItem={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: /^Dismiss:/ })
    ).not.toBeInTheDocument()
  })

  it('reports the dismissed id without navigating the slide link', () => {
    const onDismissItem = vi.fn()
    render(
      <AnnouncementSlot
        items={[LINKED_ADMIN_ITEM]}
        dismissibleIds={[LINKED_ADMIN_ITEM.id]}
        onDismissItem={onDismissItem}
      />
    )

    const dismiss = screen.getByRole('button', {
      name: `Dismiss: ${LINKED_ADMIN_ITEM.title}`
    })

    const notPrevented = fireEvent.click(dismiss)

    expect(notPrevented).toBe(false)
    expect(onDismissItem).toHaveBeenCalledWith('admin-1')
  })

  it('keeps the dismiss control keyboard reachable on the active slide', () => {
    render(
      <AnnouncementSlot
        items={[LINKED_ADMIN_ITEM]}
        dismissibleIds={[LINKED_ADMIN_ITEM.id]}
        onDismissItem={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', {
        name: `Dismiss: ${LINKED_ADMIN_ITEM.title}`
      })
    ).toHaveAttribute('tabindex', '0')
  })
})

describe('AnnouncementSlot index bookkeeping on a dynamic slide list', () => {
  const SLIDE_A: NewsItem = {
    id: 'a',
    type: 'announcement',
    title: 'First',
    href: '/a'
  }
  const SLIDE_B: NewsItem = {
    id: 'b',
    type: 'announcement',
    title: 'Second',
    href: '/b'
  }

  it('re-reads the snap index on reInit, not only on select', () => {
    const { unmount } = render(<AnnouncementSlot items={[SLIDE_A, SLIDE_B]} />)

    // A dismissal fires only embla's 'reInit', so a 'select'-only subscription never re-reads the index.
    expect(mockEmblaApi.on).toHaveBeenCalledWith('reInit', expect.any(Function))

    act(() => {
      embla.selectedSnap = 1
      emitEmbla('reInit')
    })

    const slides = screen.getAllByRole('group')
    expect(slides[0]).toHaveAttribute('tabindex', '-1')
    expect(slides[1]).toHaveAttribute('tabindex', '0')

    unmount()
    expect(mockEmblaApi.off).toHaveBeenCalledWith(
      'reInit',
      expect.any(Function)
    )
  })

  it('keeps the survivor reachable when the active last slide is removed', () => {
    embla.selectedSnap = 1
    const { rerender } = render(<AnnouncementSlot items={[SLIDE_A, SLIDE_B]} />)
    expect(screen.getAllByRole('group')[1]).toHaveAttribute('tabindex', '0')

    // Without the clamp the survivor stays at tabIndex={-1} with no nav to heal it.
    rerender(<AnnouncementSlot items={[SLIDE_A]} />)

    expect(screen.getByRole('group')).toHaveAttribute('tabindex', '0')
  })
})

describe('BriefingPage carousel wiring (real call site)', () => {
  it('appends the nudge after the admin announcement', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(<BriefingPage {...BRIEFING_PROPS} newsItems={[ADMIN_ITEM]} />)

    expect(await screen.findByText(TOKEN_ALERT_NUDGE_TITLE)).toBeInTheDocument()

    const slides = screen.getAllByRole('group')
    expect(slides).toHaveLength(2)
    expect(slides[0]).toHaveTextContent('Season 106 starts Friday')
    expect(slides[1]).toHaveTextContent(TOKEN_ALERT_NUDGE_TITLE)
  })

  it('honours a recorded dismissal (regression: optional `dismissed` was fail-open)', async () => {
    window.localStorage.setItem(DISMISSAL_KEY, '1')
    stubGet(ELIGIBLE_LINKED)

    render(<BriefingPage {...BRIEFING_PROPS} newsItems={[ADMIN_ITEM]} />)

    await settleNudgeFetch()
    expect(screen.queryByText(TOKEN_ALERT_NUDGE_TITLE)).not.toBeInTheDocument()
    expect(screen.getByText('Season 106 starts Friday')).toBeInTheDocument()
  })

  it('dismisses the nudge slide in place and persists it, leaving admin items', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(<BriefingPage {...BRIEFING_PROPS} newsItems={[ADMIN_ITEM]} />)

    const dismiss = await screen.findByRole('button', {
      name: `Dismiss: ${TOKEN_ALERT_NUDGE_TITLE}`
    })
    fireEvent.click(dismiss)

    expect(screen.queryByText(TOKEN_ALERT_NUDGE_TITLE)).not.toBeInTheDocument()
    expect(screen.getByText('Season 106 starts Friday')).toBeInTheDocument()
    expect(window.localStorage.getItem(DISMISSAL_KEY)).toBe('1')
  })

  it('leaves the surviving admin slide keyboard-reachable after the nudge is dismissed', async () => {
    embla.selectedSnap = 1
    stubGet(ELIGIBLE_LINKED)

    render(
      <BriefingPage
        {...BRIEFING_PROPS}
        newsItems={[{ ...ADMIN_ITEM, href: '/announcements' }]}
      />
    )

    const dismiss = await screen.findByRole('button', {
      name: `Dismiss: ${TOKEN_ALERT_NUDGE_TITLE}`
    })
    fireEvent.click(dismiss)

    const survivor = screen.getByRole('group')
    expect(survivor).toHaveTextContent('Season 106 starts Friday')
    expect(survivor).toHaveAttribute('tabindex', '0')
  })

  it('offers no dismiss control on admin slides', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(<BriefingPage {...BRIEFING_PROPS} newsItems={[ADMIN_ITEM]} />)

    await screen.findByText(TOKEN_ALERT_NUDGE_TITLE)
    expect(
      screen.queryByRole('button', {
        name: 'Dismiss: Season 106 starts Friday'
      })
    ).not.toBeInTheDocument()
  })

  it('renders the rail from the nudge alone when there are no admin items', async () => {
    stubGet(ELIGIBLE_UNLINKED)

    render(<BriefingPage {...BRIEFING_PROPS} />)

    expect(await screen.findByText(TOKEN_ALERT_NUDGE_TITLE)).toBeInTheDocument()
  })

  it('skips the token-alert fetch entirely in the officer view', async () => {
    nav.params = new URLSearchParams('view=officer')
    stubGet(ELIGIBLE_LINKED)

    render(
      <BriefingPage
        {...BRIEFING_PROPS}
        profile={{ role: 'officer', guild_code: 'EOT_GR' }}
        canSeeOfficerView
        newsItems={[ADMIN_ITEM]}
      />
    )

    expect(await screen.findByText('Officer briefing body')).toBeInTheDocument()
    expect(screen.queryByText(TOKEN_ALERT_NUDGE_TITLE)).not.toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('TokenAlertNudgeCard', () => {
  it('renders nothing when the feature is unavailable', async () => {
    stubGet({ available: false })

    const { container } = render(<TokenAlertNudgeCard />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('renders nothing when an alert toggle is already enabled', async () => {
    stubGet(OPTED_IN)

    const { container } = render(<TokenAlertNudgeCard />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('renders the linked variant pointing at /profile', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(<TokenAlertNudgeCard />)

    expect(await screen.findByText(TOKEN_ALERT_NUDGE_TITLE)).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /Turn on token alerts/ })
    expect(link).toHaveAttribute('href', '/profile')

    expect(
      screen.queryByText(/need a linked Discord account/i)
    ).not.toBeInTheDocument()
  })

  it('renders the link-Discord variant pointing at Connected Accounts', async () => {
    stubGet(ELIGIBLE_UNLINKED)

    render(<TokenAlertNudgeCard />)

    const link = await screen.findByRole('link', {
      name: /Link your Discord account/
    })
    expect(link).toHaveAttribute('href', '/profile#connected-accounts')

    expect(
      screen.getByText(/Token alerts need a linked Discord account/i)
    ).toBeInTheDocument()
  })

  it('explains all three alert types', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(<TokenAlertNudgeCard />)

    expect(
      await screen.findByText(
        /full, a set number of minutes before they cap, or every time you gain one/i
      )
    ).toBeInTheDocument()
  })

  it('hides on dismiss and records the shared localStorage key', async () => {
    stubGet(ELIGIBLE_LINKED)

    const { container } = render(<TokenAlertNudgeCard />)

    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    fireEvent.click(dismiss)

    expect(container).toBeEmptyDOMElement()
    expect(window.localStorage.getItem(DISMISSAL_KEY)).toBe('1')
  })

  it('stays hidden when already dismissed', async () => {
    window.localStorage.setItem(DISMISSAL_KEY, '1')
    stubGet(ELIGIBLE_LINKED)

    const { container } = render(<TokenAlertNudgeCard />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('renders nothing and does not throw when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() => Promise.reject(new Error('network down')))
    )

    const { container } = render(<TokenAlertNudgeCard />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })
})

/** The gate is `enableSearch` (someone else's stats), a call-site fact role casing cannot defeat. */
describe('PlayerStatsPage nudge card gate (real call site)', () => {
  const STATS_PROPS = {
    userGuild: 'EOT_GR',
    userGuildName: 'Example Alliance',
    clusterCode: 'EOT',
    selectedSeason: '106'
  }

  it('shows the card on the member "Your Stats" surface', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(
      <PlayerStatsPage
        {...STATS_PROPS}
        userRole="member"
        userDisplayName="Timmy"
      />
    )

    expect(await screen.findByText(TOKEN_ALERT_NUDGE_TITLE)).toBeInTheDocument()
  })

  it('hides the card on Player Lookup even for a capitalised role', async () => {
    stubGet(ELIGIBLE_LINKED)

    render(
      <PlayerStatsPage
        {...STATS_PROPS}
        enableSearch
        userRole="Officer"
        userDisplayName=""
        initialPlayerName="Other"
      />
    )

    // The card never mounts here, so its fetch is not a usable settle point.
    expect(
      await screen.findByRole('heading', { name: 'Player Search' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Select player')).toBeInTheDocument()

    expect(screen.queryByText(TOKEN_ALERT_NUDGE_TITLE)).not.toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
