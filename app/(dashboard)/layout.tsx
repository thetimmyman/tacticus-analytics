import { requireAuth } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import DashboardShell from '@/app/components/dashboard/DashboardShell'
import { RevokedKeyBanner } from '@/app/components/alerts/RevokedKeyBanner'
import { getOpenRevokedKeyIncidentForUser } from '@/app/lib/data/revoked-key-incident'
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
  const revokedKeyIncident = await getOpenRevokedKeyIncidentForUser(
    await db(),
    profile
  )

  return (
    <DashboardShell user={user} profile={profile}>
      <RevokedKeyBanner incident={revokedKeyIncident} />
      {children}
    </DashboardShell>
  )
}
