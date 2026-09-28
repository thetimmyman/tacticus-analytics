import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import ExploreContent from './ExploreContent'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { Metadata } from 'next'
import { Breadcrumbs } from '@/app/components/navigation/Breadcrumbs'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Explore Guilds - Tacticus Analytics | Guild Rankings & Performance',
  description:
    'Compare public Tacticus guild raid snapshots, boss damage, and cluster rankings.',
  keywords:
    'tacticus guilds, guild rankings, guild performance, cluster rankings, guild statistics, tacticus leaderboards',
  openGraph: {
    title: 'Explore Guilds - Tacticus Analytics',
    description:
      'Compare public guild raid snapshots, boss damage, and cluster rankings.',
    images: ['/explore/og']
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Explore Guilds - Tacticus Analytics',
    description:
      'Compare public guild raid snapshots, boss damage, and cluster rankings.',
    images: ['/explore/og']
  }
}

export default async function ExplorePage() {
  const authData = await getAuthUser()

  return (
    <>
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="mb-4">
          <Breadcrumbs items={[{ name: 'Explore Guilds', href: '/explore' }]} />
        </div>

        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary-wh40k mb-3 sm:mb-4">
            Explore Guilds
          </h1>
          <p className="text-secondary-wh40k text-base sm:text-lg max-w-2xl mx-auto px-4">
            Compare public guild raid damage, boss hits, and cluster rankings
            from shared snapshots
          </p>
        </div>

        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-(--primary)" />
            </div>
          }
        >
          <ExploreContent />
        </Suspense>
      </div>
    </>
  )
}
