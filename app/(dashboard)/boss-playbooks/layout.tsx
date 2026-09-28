import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import { getFeatureReleaseStage } from '@/app/lib/services/feature-release-service'

export default async function BossPlaybooksLayout({
  children
}: {
  children: React.ReactNode
}) {
  const stage = await getFeatureReleaseStage('boss_playbooks')

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-primary-wh40k">
            Boss Playbooks
          </h1>
          {stage && stage !== 'public' && (
            <ReleaseStageBadge stage={stage} size="md" />
          )}
        </div>
        <p className="text-secondary-wh40k mt-2">
          Seasonal raid planning, maps, and Herald operations for all guild raid
          bosses
        </p>
      </div>

      <div>{children}</div>
    </div>
  )
}
