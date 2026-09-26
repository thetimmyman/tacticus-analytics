import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const metadata = createPageMetadata({
  title: 'Cluster Onboarding',
  description:
    'Set up a guild cluster for shared Tacticus Analytics leaderboards and coordination.',
  path: '/onboarding/cluster'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
