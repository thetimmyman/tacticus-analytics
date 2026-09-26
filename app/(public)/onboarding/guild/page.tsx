import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const metadata = createPageMetadata({
  title: 'Guild Onboarding',
  description: 'Register or connect a guild to Tacticus Analytics onboarding.',
  path: '/onboarding/guild'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
