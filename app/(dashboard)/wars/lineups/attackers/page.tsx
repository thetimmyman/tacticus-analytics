import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import AttackerPerformancePage from '@/app/(dashboard)/wars/performance/attackers/ClientPage'

export const metadata = createPageMetadata({
  title: 'Offense Heroes',
  description:
    'Per-unit guild war offense hero success rates. Part of the Lineups page.',
  path: '/wars/lineups/attackers'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AttackerPerformancePage />
    </Suspense>
  )
}
