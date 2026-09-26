import { redirect } from 'next/navigation'
import { requireAuthAllowInactive } from '@/app/lib/auth'
import DashboardShell from '@/app/components/dashboard/DashboardShell'
import type { AppUser } from '@/app/types'

export const dynamic = 'force-dynamic'

/** `member` is the lowest role and never carries former officer/leader/admin standing. */
function scrubInactiveDashboardUser(user: AppUser): AppUser {
  return {
    ...user,
    role: 'member',
    guildCode: null,
    avatarUrl: null,
    profile: null
  }
}

export default async function InactiveDashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  const user = await requireAuthAllowInactive()

  if (user.membershipStatus === 'none') {
    redirect('/onboarding')
  }

  const hasActiveProfile =
    user.membershipStatus === 'active' && user.profile?.is_current === true

  const shellUser = hasActiveProfile ? user : scrubInactiveDashboardUser(user)
  const shellProfile = hasActiveProfile ? user.profile : null

  return (
    <DashboardShell
      user={shellUser}
      profile={shellProfile}
      hideAnalytics={!hasActiveProfile}
    >
      {children}
    </DashboardShell>
  )
}
