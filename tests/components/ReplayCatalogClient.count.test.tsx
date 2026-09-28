import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/replays',
  useSearchParams: () => new URLSearchParams()
}))
vi.mock('@/app/lib/catalogs/heroes', () => ({
  useHeroCatalog: () => ({ data: [] })
}))
vi.mock('@/app/components/ui/HeroUnitPortrait', () => ({
  HeroUnitPortrait: () => null
}))
vi.mock('@/app/components/ui/BossPortrait', () => ({
  BossPortrait: () => null
}))

import { ReplayCatalogClient } from '@/app/(dashboard)/replays/ReplayCatalogClient'
import type {
  CommunityReplayFacets,
  CommunityReplayFilters,
  CommunityReplayPage
} from '@/app/lib/replays/community-replay-catalog-shared'

const facets: CommunityReplayFacets = {
  bosses: [],
  difficulties: [],
  seasons: []
}
const filters: CommunityReplayFilters = {}

describe('ReplayCatalogClient count', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [1234, '1,234 replays'],
    [1, '1 replay']
  ])(
    'formats total %i as %s under a German default locale',
    (total, expected) => {
      const original = Number.prototype.toLocaleString
      vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
        this: number,
        locales,
        options
      ) {
        return original.call(this, locales ?? 'de-DE', options)
      })
      const result: CommunityReplayPage = {
        replays: [],
        total,
        page: 1,
        pageSize: 48,
        loadFailed: false
      }

      render(
        <ReplayCatalogClient
          result={result}
          facets={facets}
          filters={filters}
          sort="recent"
        />
      )

      expect(screen.getByText(expected)).toBeInTheDocument()
    }
  )
})
