import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const metadata = createPageMetadata({
  title: 'Claim Guild Invite',
  description:
    'Claim a guild invitation and connect your Tacticus player profile.',
  path: '/onboarding/claim'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
