import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import { getFeatureReleaseStage } from '@/app/lib/services/feature-release-service'

export default async function RosterDevelopmentLayout({
  children
}: {
  children: React.ReactNode
}) {
  const stage = await getFeatureReleaseStage('roster_development')

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            Roster Development
          </h1>
          {stage && stage !== 'public' && (
            <ReleaseStageBadge stage={stage} size="md" />
          )}
        </div>
        <p className="text-[var(--text-secondary)] mt-2">
          Data-driven roster gap analysis and player development paths
        </p>
      </div>

      <div>{children}</div>
    </div>
  )
}
