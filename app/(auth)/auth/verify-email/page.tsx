import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Verify Email',
  description:
    'Verify your email address to complete Tacticus Analytics account setup.',
  path: '/auth/verify-email'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
