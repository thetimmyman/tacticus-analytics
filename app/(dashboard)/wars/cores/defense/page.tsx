import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import CoresPage from '@/app/(dashboard)/wars/_components/CoresPage'

export const metadata = createPageMetadata({
  title: 'Defense Cores',
  description:
    'Review high-performing guild war defense cores and flex picks by usage and win rate.',
  path: '/wars/cores/defense'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CoresPage side="defense" />
    </Suspense>
  )
}
