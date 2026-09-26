import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import CoresPage from '@/app/(dashboard)/wars/_components/CoresPage'

export const metadata = createPageMetadata({
  title: 'Offense Cores',
  description:
    'Review high-performing guild war offense cores and flex picks by usage and win rate.',
  path: '/wars/cores/offense'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CoresPage side="offense" />
    </Suspense>
  )
}
