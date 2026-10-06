import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'

import { requireAuth } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import DashboardShell from '@/app/components/dashboard/DashboardShell'
import DesktopAccessGate from '@/app/components/dashboard/DesktopAccessGate'
import { GuildSyncStoppedBanner } from '@/app/components/alerts/GuildSyncStoppedBanner'
import { getOpenGuildSyncIncidentForUser } from '@/app/lib/data/guild-sync-incident'
import { createPageMetadata } from '@/app/lib/metadata'

// All dashboard pages require auth.
export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Guild Dashboard',
  description:
    'Authenticated guild workspace for raid metrics, roster tracking, assignment planning, and operations tools.'
})

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  const { user, profile } = await requireAuth()

  // Session client so RLS scopes the row; in the layout so the banner shows on every page.
  const guildSyncIncident =
    getRuntimeProfile() === 'hosted'
      ? await getOpenGuildSyncIncidentForUser(await db(), profile)
      : null

  return (
    <DashboardShell user={user} profile={profile}>
      <GuildSyncStoppedBanner incident={guildSyncIncident} />
      {getRuntimeProfile() === 'desktop' ? (
        <DesktopAccessGate>{children}</DesktopAccessGate>
      ) : (
        children
      )}
    </DashboardShell>
  )
}
