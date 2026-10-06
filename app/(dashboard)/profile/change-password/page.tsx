import { redirect } from 'next/navigation'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { requireAuth } from '@/app/lib/auth'
import ChangePasswordClient from './ChangePasswordClient'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Change Password',
  description:
    'Update the password for your authenticated Tacticus Analytics account.',
  path: '/profile/change-password'
})

export default async function ChangePasswordPage() {
  if (getRuntimeProfile() === 'desktop') redirect('/profile')
  const { user } = await requireAuth()

  return <ChangePasswordClient userEmail={user.email} />
}
