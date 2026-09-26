import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import LineupsPage from '@/app/(dashboard)/wars/_components/LineupsPage'

export const metadata = createPageMetadata({
  title: 'Defense Lineups',
  description:
    'Compare top guild war defense lineups by usage, win rate, and average power.',
  path: '/wars/lineups/defense'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LineupsPage side="defense" />
    </Suspense>
  )
}
