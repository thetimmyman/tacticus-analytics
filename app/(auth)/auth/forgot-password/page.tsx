import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Forgot Password',
  description:
    'Request a password reset link for your Tacticus Analytics account.',
  path: '/auth/forgot-password'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
