import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import { getCurrentUser } from '@/app/lib/auth'
import ClientPage from './ClientPage'

export const metadata = createPageMetadata({
  title: 'Get Started',
  description:
    'Choose how to get started with Tacticus Analytics as a player, guild, or cluster leader.',
  path: '/onboarding'
})

export default async function Page() {
  // Guildless accounts land here from /profile, so offer deletion; anonymous visitors get none.
  const appUser = await getCurrentUser()

  return (
    <Suspense fallback={null}>
      <ClientPage userId={appUser?.id} />
    </Suspense>
  )
}
