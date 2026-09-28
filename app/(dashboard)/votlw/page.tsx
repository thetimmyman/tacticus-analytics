import dynamic from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import { getLatestSeason } from '@/app/lib/utils/season'
import { resolveEffectiveSeason } from '@/app/lib/season-date/precedence'
import { EmptyState } from '@tacticus/ui-kit'
import { Spinner } from '@tacticus/ui-kit'
import { createPageMetadata } from '@/app/lib/metadata'
import type { UserRole } from '@tacticus/app-core/types'

export const metadata = createPageMetadata({
  title: 'VOTLW Awards',
  description:
    'Review Veteran of the Long War awards, raid contribution highlights, and season recognition data.',
  path: '/votlw'
})

const VOTLW = dynamic(() => import('@/app/components/votlw/VOTLWContainer'), {
  loading: () => (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto mb-4 h-12 w-12 text-primary" />
        <p className="text-secondary-wh40k">Loading VOTLW data...</p>
      </div>
    </div>
  )
})

interface PageProps {
  searchParams: Promise<{ guild?: string; season?: string }>
}

export default async function VOTLWPage({ searchParams }: PageProps) {
  const authData = await requireAuth()

  const userGuild = authData.profile.guild_code
  const userRole: UserRole = authData.profile.role ?? 'member'

  const params = await searchParams

  const selectedGuild = params.guild || userGuild || ''
  const latestSeason = await getLatestSeason()
  const selectedSeason = resolveEffectiveSeason(params.season, latestSeason)

  if (!selectedSeason) {
    return (
      <div className="px-4 py-6">
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      </div>
    )
  }

  // Officer/leader roles apply only to their own guild's page; others see member view.
  const effectiveRole: UserRole =
    selectedGuild &&
    userGuild &&
    selectedGuild.toUpperCase() === userGuild.toUpperCase()
      ? userRole
      : 'member'

  return (
    <VOTLW
      selectedGuild={selectedGuild}
      selectedSeason={selectedSeason}
      userRole={effectiveRole}
    />
  )
}
