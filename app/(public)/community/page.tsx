import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const metadata = createPageMetadata({
  title: 'Community',
  description:
    'Connect with the Tacticus Analytics community and content creator resources.',
  path: '/community'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
