import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { getSavedQueuePageContext } from '@/app/lib/boss-assignments/saved-queue'
import { AppError } from '@/app/lib/errors/AppError'
import { EmptyState } from '@tacticus/ui-kit'
import SavedCurrentQueueClient from './SavedCurrentQueueClient'
import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { BossAssignments } from '@/app/(dashboard)/boss-assignments/BossAssignments'

// Per-request rendering so a `?season=` change re-runs the server component.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Current Season Assignments | Tacticus Analytics',
  description: 'Manage current season boss assignments and token allocation'
}

interface PageProps {
  searchParams: Promise<{ season?: string | string[] }>
}

// Season-planner access does not gate this route; the layout computes it for the sub-nav.
export default async function CurrentAssignmentsPage({
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
    const context = await getSavedQueuePageContext({
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
          Use API access and sync to import raid history with a captured
          configuration before opening saved assignments.
        </EmptyState>
      )
    return (
      <SavedCurrentQueueClient
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
      mode="current"
      canEdit={canEdit}
      seasonOverride={(params.season as string | undefined) ?? null}
    />
  )
}
