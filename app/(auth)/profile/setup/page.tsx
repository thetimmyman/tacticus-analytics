import { redirect } from 'next/navigation'
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Claim Profile',
  description: 'Claim your player profile with a single-use invite code.',
  path: '/profile/setup'
})

export default function Page() {
  redirect('/onboarding/claim')
}
