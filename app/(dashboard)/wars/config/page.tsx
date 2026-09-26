import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import ConfigClient from './ConfigClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'War Config | Tacticus Analytics',
  description: 'Guild war strategy notes and manual data import.'
}

export default async function WarConfigPage() {
  const { user, profile } = await requireAuth()

  const access = await checkFeatureAccess(user.id, 'war_tracking')
  if (!access.has_access) {
    redirect('/home')
  }

  if (!profile.guild_code) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          War Config
        </h1>
        <p className="mt-4 text-[var(--text-secondary)]">
          Join a guild to configure war strategy and manual imports.
        </p>
      </div>
    )
  }

  return (
    <ConfigClient
      guildCode={profile.guild_code}
      userRole={profile.role ?? 'member'}
    />
  )
}
