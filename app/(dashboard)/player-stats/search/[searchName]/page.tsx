import { fetchPlayerStats } from './actions'
import { notFound } from 'next/navigation'
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ searchName: string }>
  searchParams: Promise<{ guild?: string; season?: string }>
}

export async function generateMetadata({ params }: Pick<PageProps, 'params'>) {
  const { searchName } = await params
  const playerName = decodeURIComponent(searchName)

  return createPageMetadata({
    title: `${playerName} Player Stats`,
    description:
      'Direct player statistics payload for the selected guild and season filters.'
  })
}

export default async function PlayerStatsSearchPage({
  params,
  searchParams
}: PageProps) {
  const { searchName } = await params
  const { guild, season } = await searchParams

  if (!searchName || !guild || !season) {
    notFound()
  }

  const { stats, error } = await fetchPlayerStats(
    decodeURIComponent(searchName),
    guild,
    season
  )

  if (error || !stats) {
    // Only stats are embedded, for direct URL access.
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">
          Error loading player stats: {error || 'Unknown error'}
        </p>
      </div>
    )
  }

  // Sanitized JSON prevents script injection.
  const sanitizedStats = JSON.stringify(stats)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')

  return (
    <script
      type="application/json"
      id="player-stats-data"
      dangerouslySetInnerHTML={{ __html: sanitizedStats }}
    />
  )
}
