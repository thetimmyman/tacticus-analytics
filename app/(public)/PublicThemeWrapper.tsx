import { getAuthUser } from '@/app/lib/auth'
import { getActiveMembershipProfile } from '@/app/lib/auth/active-membership-profile'
import PublicThemeClient from './PublicThemeClient'

export default async function PublicThemeWrapper({
  children
}: {
  children: React.ReactNode
}) {
  const authData = await getAuthUser()
  // An inactive account's last mapping is not theme authority, or public routes would resurrect its guild theme.
  const themeProfile = getActiveMembershipProfile(authData)

  return (
    <PublicThemeClient profile={themeProfile}>{children}</PublicThemeClient>
  )
}
