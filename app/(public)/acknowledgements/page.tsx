import { Metadata } from 'next'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { getActiveMembershipProfile } from '@/app/lib/auth/active-membership-profile'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Acknowledgements | Tacticus Analytics',
  description: 'Honoring the contributors who made this project possible'
}

const contributors = [
  { name: 'Towen' },
  { name: 'Djaff' },
  { name: 'Ouchkabibbles' },
  { name: 'ATH' },
  { name: 'Nandi' },
  { name: 'Aernz' },
  { name: 'Moo' },
  { name: 'FMG' },
  { name: 'Krogarth' },
  { name: 'Blastinator' },
  { name: 'TableTheTable' },
  { name: 'Eversor' },
  { name: 'Adj' },
  { name: 'KYi' },
  { name: 'Karlzone' },
  { name: 'xX3F4RXx' },
  { name: 'Tani' },
  { name: 'Slacker' },
  { name: 'HZM' }
]

export default async function AcknowledgementsPage() {
  const authData = await getAuthUser()
  const activeProfile = getActiveMembershipProfile(authData)

  let clusterName = 'Tacticus Analytics'
  if (activeProfile) {
    try {
      const { getClusterInfoFromProfile } =
        await import('@/app/lib/utils/cluster')
      const clusterInfo = await getClusterInfoFromProfile({
        guild_code: activeProfile.guild_code ?? undefined
      })
      clusterName = clusterInfo.display_name
    } catch {
      // Use the default.
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-(--bg-from) via-(--bg-via) to-(--bg-to)">
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />
      <div className="max-w-6xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-linear-to-r from-(--accent) to-(--primary) mb-4">
            Acknowledgements
          </h1>
          <p className="text-xl text-secondary-wh40k max-w-3xl mx-auto">
            The {clusterName} guild raid dashboard would not have been possible
            without the dedication, support, and contributions of these
            exceptional individuals.
          </p>
        </div>

        {/* Quote */}
        <div className="mb-16 p-8 bg-linear-to-r from-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] to-(--card-bg) rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)]">
          <blockquote className="text-center">
            <p className="text-2xl text-primary-wh40k italic mb-4">
              &quot;From {clusterName} we emerge, united in purpose. Through
              chaos, we find strength. Through war, we find brotherhood.&quot;
            </p>
            <footer className="text-(--accent)">
              — The strength of our cluster lies in our unity
            </footer>
          </blockquote>
        </div>

        {/* Contributors Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {contributors.map((contributor) => (
            <div
              key={contributor.name}
              className="bg-linear-to-br from-(--card-bg) to-(--bg-primary) p-6 rounded-lg border border-(--card-border) 
                         hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] transition-all duration-300 hover:shadow-lg hover:shadow-[color-mix(in_srgb,var(--accent)_10%,transparent)]
                         flex items-center justify-center"
            >
              <h3 className="text-xl font-bold text-(--accent) text-center">
                {contributor.name}
              </h3>
            </div>
          ))}
        </div>

        {/* Special Thanks */}
        <div className="bg-linear-to-r from-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] to-(--card-bg) rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] p-8">
          <h2 className="text-2xl font-bold text-(--accent) mb-4 text-center">
            Special Thanks
          </h2>
          <div className="space-y-4 text-secondary-wh40k text-center">
            <p>
              To all the members of the {clusterName} cluster guilds who
              provided feedback, reported bugs, and helped shape this dashboard.
            </p>
            <p>
              To the guild leaders whose vision and support were needed to make
              it a reality.
            </p>
            <p>
              To everyone who spent hours testing features, validating data, and
              ensuring the accuracy of our calculations.
            </p>
            <p className="text-xl font-semibold text-(--accent) pt-4">
              For {clusterName}! For Chaos Undivided!
            </p>
          </div>
        </div>

        {/* Footer Message */}
        <div className="mt-16 text-center">
          <p className="text-secondary-wh40k text-sm">
            This dashboard is a testament to what we can achieve when we work
            together.
          </p>
          <p className="text-amber-100/60 text-sm mt-2">
            May it serve the cluster well in all battles to come.
          </p>
        </div>
      </div>
    </div>
  )
}
