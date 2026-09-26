import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { RosterDevelopmentClient } from './RosterDevelopmentClient'

export const metadata: Metadata = {
  title: 'Roster Development - Build a Stronger Guild | Tacticus Analytics',
  description:
    'Data-driven roster gap analysis and player development paths to build a stronger guild.'
}

export default async function RosterDevelopmentPage() {
  const { user, profile } = await requireAuth()

  const access = await checkFeatureAccess(user.id, 'roster_development')

  if (!access.has_access) {
    redirect('/home')
  }

  const guildCode = profile?.guild_code || ''

  return <RosterDevelopmentClient guildCode={guildCode} />
}
