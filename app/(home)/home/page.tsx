import InactiveHome from './InactiveHome'
import { requireAuthAllowInactive } from '@/app/lib/auth'
import { createPageMetadata } from '@/app/lib/metadata'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Command Home',
  description:
    'Review your guild raid command summary, forecast, token status, and current operational alerts.',
  path: '/home'
})

interface PageProps {
  searchParams: Promise<{ season?: string }>
}

export default async function HomePage({ searchParams }: PageProps) {
  const user = await requireAuthAllowInactive()

  if (user.membershipStatus === 'none') {
    redirect('/onboarding')
  }

  // Inactive mappings exist only for recovery: never carry their guild, role or admin state into /home,
  // and return before importing any guild-data loader.
  if (
    user.membershipStatus !== 'active' ||
    !user.profile ||
    user.profile.is_current !== true
  ) {
    return <InactiveHome displayName={user.displayName || undefined} />
  }

  const { default: ActiveHomePage } = await import('./active-page')
  return <ActiveHomePage user={user} searchParams={searchParams} />
}
