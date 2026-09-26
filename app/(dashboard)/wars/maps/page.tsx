import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { createPageMetadata } from '@/app/lib/metadata'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import MapsClient from './MapsClient'

export const metadata = createPageMetadata({
  title: 'War Maps',
  description:
    'Inspect guild war map performance, win rates, battle counts, and strategic notes.',
  path: '/wars/maps'
})

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { user, profile } = await requireAuth()
  const access = await checkFeatureAccess(user.id, 'war_tracking')
  if (!access.has_access) redirect('/home')

  return (
    <Suspense fallback={null}>
      <MapsClient
        guildCode={profile.guild_code ?? ''}
        userRole={profile.role ?? 'member'}
      />
    </Suspense>
  )
}
