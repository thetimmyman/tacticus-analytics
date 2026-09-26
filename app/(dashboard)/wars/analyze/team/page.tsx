import { Suspense } from 'react'
import { createPageMetadata } from '@/app/lib/metadata'
import ClientPage from './ClientPage'

export const metadata = createPageMetadata({
  title: 'War Team Analyzer',
  description:
    'Analyze guild war teams, selected units, and roster-pool matchups for stronger attacks.',
  path: '/wars/analyze/team'
})

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientPage />
    </Suspense>
  )
}
