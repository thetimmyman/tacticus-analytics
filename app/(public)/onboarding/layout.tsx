import { Metadata } from 'next'
import { getCurrentUser } from '@/app/lib/auth'
import { NavigationServer } from '@/app/components/NavigationServer'

export const metadata: Metadata = {
  title: 'Get Started - Tacticus Analytics | Join Your Guild',
  description:
    'Get started with Tacticus Analytics by joining your guild or creating a new cluster. Set up raid analytics for Warhammer 40,000: Tacticus.',
  keywords:
    'tacticus analytics onboarding, join guild, create cluster, guild setup, tacticus registration',
  openGraph: {
    title: 'Get Started - Tacticus Analytics',
    description: 'Join your guild or create a new cluster for raid analytics',
    images: ['/onboarding/og']
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Get Started - Tacticus Analytics',
    description: 'Join your guild or create a new cluster for raid analytics',
    images: ['/onboarding/og']
  }
}

export default async function OnboardingLayout({
  children
}: {
  children: React.ReactNode
}) {
  // Profile-less new signups get OnboardingNav, not PublicNav.
  const appUser = await getCurrentUser()

  // Keep membershipStatus so NavigationServer can scrub an inactive account's stale role and guild.
  const user = appUser
    ? { id: appUser.id, membershipStatus: appUser.membershipStatus }
    : undefined
  const profile = appUser
    ? (appUser.profile ?? { user_id: appUser.id, role: 'onboarding' as const })
    : undefined

  return (
    <>
      <NavigationServer user={user} profile={profile} hideAnalytics={true} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </>
  )
}
