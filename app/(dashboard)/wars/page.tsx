import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
export const dynamic = 'force-dynamic'

const WarReportsOverview = dynamicImport(
  () => import('./_components/WarReportsOverview'),
  {
    loading: () => (
      <div className="p-6 text-secondary-wh40k">Loading war overview...</div>
    )
  }
)

const WarsListClient = dynamicImport(
  () => import('./_components/WarsListClient'),
  {
    loading: () => (
      <div className="p-6 text-secondary-wh40k">Loading war reports...</div>
    )
  }
)

export const metadata: Metadata = {
  title: 'War Reports | Tacticus Analytics',
  description: 'View your guild war history, results, and analytics.'
}

export default async function WarsIndexPage() {
  const { user, profile } = await requireAuth()

  const access = await checkFeatureAccess(user.id, 'war_tracking')
  if (!access.has_access) {
    redirect('/home')
  }

  if (!profile.guild_code) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold text-primary-wh40k">War Reports</h1>
        <p className="mt-4 text-secondary-wh40k">
          Join a guild to see war reports. War data will appear here once your
          guild starts tracking.
        </p>
      </div>
    )
  }

  return (
    <>
      <WarReportsOverview guildCode={profile.guild_code} />
      <WarsListClient guildCode={profile.guild_code} />
    </>
  )
}
