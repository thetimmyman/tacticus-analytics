import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Authentication Error',
  description:
    'Review authentication errors and recover access to your Tacticus Analytics account.',
  path: '/auth/error'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
