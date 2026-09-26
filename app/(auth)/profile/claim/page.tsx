import { redirect } from 'next/navigation'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Claim Profile',
  description:
    'Continue onboarding by linking your Tacticus account to an existing guild profile.'
})

export default function ProfileClaimPage() {
  redirect('/onboarding/claim')
}
