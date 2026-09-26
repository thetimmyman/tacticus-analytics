import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Reset Password',
  description: 'Set a new password for your Tacticus Analytics account.',
  path: '/auth/reset-password'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
