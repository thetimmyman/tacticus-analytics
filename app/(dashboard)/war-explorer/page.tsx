import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import dynamicImport from 'next/dynamic'
import { requireRole } from '@/app/lib/auth'
import {
  checkFeatureAccess,
  getFeatureReleaseStage
} from '@/app/lib/services/feature-release-service'

const GuildWarExplorerClient = dynamicImport(
  () => import('./GuildWarExplorerClient'),
  {
    loading: () => (
      <div className="p-6 text-secondary-wh40k">Loading war explorer...</div>
    )
  }
)

export const metadata: Metadata = {
  title: 'Guild War Explorer | Tacticus Analytics',
  description:
    'Explore guild war data across all guilds - matches, player activity, and zone assignments'
}

export default async function GuildWarExplorerPage() {
  const { user } = await requireRole('member')

  const [access, releaseStage] = await Promise.all([
    checkFeatureAccess(user.id, 'war_explorer'),
    getFeatureReleaseStage('war_explorer')
  ])

  if (!access.has_access) {
    redirect('/home')
  }

  return <GuildWarExplorerClient releaseStage={releaseStage} />
}
