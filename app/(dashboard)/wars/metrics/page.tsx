import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import WarAnalytics from '@/app/(dashboard)/wars/_components/WarAnalytics'
import ZoneTypeStats from './ZoneTypeStats'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Guild Metrics | Tacticus Analytics',
  description:
    'Guild war participation, War Points scoring, and per-player performance metrics.'
}

export default async function GuildMetricsPage() {
  const { user, profile } = await requireAuth()

  const access = await checkFeatureAccess(user.id, 'war_tracking')
  if (!access.has_access) {
    redirect('/home')
  }

  if (!profile.guild_code) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold text-primary-wh40k">Guild Metrics</h1>
        <p className="mt-4 text-secondary-wh40k">
          Join a guild to see war participation and performance metrics.
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 space-y-8">
      <WarAnalytics guildCode={profile.guild_code} />
      {/* The single zone-performance surface. */}
      <ZoneTypeStats />
    </div>
  )
}
