import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import DefenderPerformancePage from '@/app/(dashboard)/wars/performance/defenders/ClientPage'

export const metadata = createPageMetadata({
  title: 'Defense Heroes',
  description:
    'Per-unit guild war defense hero hold rates. Part of the Lineups page.',
  path: '/wars/lineups/defenders'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DefenderPerformancePage />
    </Suspense>
  )
}
