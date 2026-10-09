import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { BossAssignments } from '@/app/(dashboard)/boss-assignments/BossAssignments'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { EmptyState } from '@tacticus/ui-kit'
import { AppError } from '@/app/lib/errors/AppError'
import { getSavedTokenPerformancePageContext } from '@/app/lib/boss-assignments/saved-token-performance'
import SavedTokenPerformanceClient from './SavedTokenPerformanceClient'

// Per-request rendering so a ?season= change re-runs the server component.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Token Performance | Tacticus Analytics',
  description:
    'Guild leaderboard of token performance against expected damage targets'
}

interface PageProps {
  searchParams: Promise<{ season?: string | string[] }>
}

export default async function PerformanceLeaderboardPage({
  searchParams
}: PageProps) {
  if (getRuntimeProfile() === 'desktop') {
    const params = await searchParams
    if (Array.isArray(params.season))
      return (
        <EmptyState title="Saved season unavailable">
          Choose one imported season with a captured configuration.
        </EmptyState>
      )
    const context = await getSavedTokenPerformancePageContext({
      selectedSeason: params.season
    }).catch((error: unknown) => {
      if (
        error instanceof AppError &&
        (error.statusCode === 400 || error.statusCode === 422)
      )
        return null
      throw error
    })
    if (!context)
      return (
        <EmptyState title="Saved season unavailable">
          Choose one imported season with a captured configuration.
        </EmptyState>
      )
    if (!context.season)
      return (
        <EmptyState title="Import saved raid history">
          Import raid history with a captured configuration before calculating
          saved token performance.
        </EmptyState>
      )
    return (
      <SavedTokenPerformanceClient
        contextKey={context.contextKey}
        season={context.season}
        seasons={context.seasons}
        canCalculate={context.canCalculate}
      />
    )
  }
  const { profile, canEdit } = await requireBossAssignmentsAccess()

  const params = await searchParams
  return (
    <BossAssignments
      profile={profile}
      mode="performance"
      canEdit={canEdit}
      seasonOverride={(params.season as string | undefined) ?? null}
    />
  )
}
