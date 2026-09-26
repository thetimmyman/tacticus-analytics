import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Sign In',
  description:
    'Sign in or create an account to access Tacticus Analytics guild dashboards and tools.',
  path: '/auth'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
