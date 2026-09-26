import { Suspense } from 'react'
import { Metadata } from 'next'
import StatusPageClient from './StatusPageClient'

export const metadata: Metadata = {
  title: 'Service Status | Tacticus Analytics',
  description:
    'Real-time status of Tacticus Analytics services and infrastructure.',
  robots: 'noindex, nofollow' // Don't index status page
}

export const dynamic = 'force-dynamic'

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen">
            <div className="animate-pulse text-slate-400">
              Loading status...
            </div>
          </div>
        }
      >
        <StatusPageClient />
      </Suspense>
    </div>
  )
}
