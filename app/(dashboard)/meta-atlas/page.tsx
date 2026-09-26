import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import {
  checkFeatureAccess,
  getFeatureReleaseStage
} from '@/app/lib/services/feature-release-service'
const MetaAtlasClient = dynamicImport(
  () =>
    import('./MetaAtlasClient').then((mod) => ({
      default: mod.MetaAtlasClient
    })),
  {
    loading: () => (
      <div className="p-6 text-[var(--text-secondary)]">
        Loading Meta Atlas...
      </div>
    )
  }
)

export const metadata: Metadata = {
  title: "Towen's Meta Atlas - Team Benchmarks | Tacticus Analytics",
  description:
    'Discover the best-performing team compositions for each boss based on aggregated data across all guilds.'
}

export default async function MetaAtlasPage() {
  const { user, profile } = await requireAuth()

  const [access, stage] = await Promise.all([
    checkFeatureAccess(user.id, 'meta_atlas'),
    getFeatureReleaseStage('meta_atlas')
  ])

  if (!access.has_access) {
    redirect('/home')
  }

  const guildCode = profile?.guild_code || ''
  const userDisplayName = profile?.display_name || ''

  return (
    <MetaAtlasClient
      guildCode={guildCode}
      userDisplayName={userDisplayName}
      releaseStage={stage}
    />
  )
}
