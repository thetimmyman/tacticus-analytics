import type { Metadata } from 'next'
import { requireAuth } from '@/app/lib/auth'
import {
  isCatalogSort,
  loadCommunityReplayFacets,
  loadCommunityReplayPage,
  type CatalogSort,
  type CommunityReplayFilters
} from '@/app/lib/replays/community-replay-catalog'
import { ReplayCatalogClient } from './ReplayCatalogClient'

export const metadata: Metadata = {
  title: 'Replays | Tacticus Analytics',
  description:
    'Browse community YouTube replays for guild raid bosses — filter by boss, encounter, difficulty, and season.'
}

// Query-string filters and per-viewer RLS: never statically cache.
export const dynamic = 'force-dynamic'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

const first = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0]?.trim() || null
  return value?.trim() || null
}

export default async function ReplaysPage({
  searchParams
}: {
  searchParams: PageSearchParams
}) {
  // Login-gated only: RLS decides rows, and a feature gate would hide public replays.
  await requireAuth()

  const params = await searchParams
  const filters: CommunityReplayFilters = {
    boss: first(params.boss),
    board: first(params.board),
    difficulty: first(params.difficulty),
    season: first(params.season),
    role: first(params.role),
    featuredOnly: first(params.featured) === '1',
    withVideoOnly: first(params.video) === '1',
    search: first(params.q)
  }

  const rawSort = first(params.sort)
  const sort: CatalogSort = isCatalogSort(rawSort) ? rawSort : 'damage'
  const rawPage = Number.parseInt(first(params.page) ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  const [result, facets] = await Promise.all([
    loadCommunityReplayPage(filters, { page, sort }),
    loadCommunityReplayFacets()
  ])

  return (
    <ReplayCatalogClient
      result={result}
      facets={facets}
      filters={filters}
      sort={sort}
    />
  )
}
