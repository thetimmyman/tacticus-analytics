import AuthThemeWrapper from './AuthThemeWrapper'
import Footer from '@/app/components/Footer'
import { RadixTooltipProvider } from '@tacticus/ui-kit/radix-tooltip'
import { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sign In - Tacticus Analytics | Access Your Guild Dashboard',
  description:
    "Sign in to access your guild's performance analytics, raid insights, and tracking tools for Warhammer 40,000: Tacticus.",
  keywords:
    'tacticus analytics login, guild access, tacticus dashboard, guild raid analytics sign in',
  openGraph: {
    title: 'Sign In - Tacticus Analytics',
    description: "Access your guild's performance analytics and raid insights",
    images: ['/WarpForgedDashboard.png']
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sign In - Tacticus Analytics',
    description: "Access your guild's performance analytics and raid insights",
    images: ['/WarpForgedDashboard.png']
  }
}

export default function AuthLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <AuthThemeWrapper>
      <RadixTooltipProvider>
        <div className="min-h-screen flex flex-col">
          {/* Skip-to-main-content link — first focusable element */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60 focus:bg-(--card-bg) focus:text-primary-wh40k focus:px-4 focus:py-2 focus:rounded-sm focus:border focus:border-accent-wh40k"
          >
            Skip to main content
          </a>
          <main id="main-content" className="grow">
            {children}
          </main>
          <Footer />
        </div>
      </RadixTooltipProvider>
    </AuthThemeWrapper>
  )
}
