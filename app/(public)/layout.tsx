import PublicThemeWrapper from './PublicThemeWrapper'
import Footer from '@/app/components/Footer'
import { createPageMetadata } from '@/app/lib/metadata'

// PublicThemeWrapper reads auth.
export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Tacticus Analytics',
  description:
    'Public Tacticus Analytics pages for guild discovery, onboarding, creator resources, and community information.'
})

export default function PublicLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <PublicThemeWrapper>
      <div className="min-h-screen flex flex-col">
        {/* Skip link: must be the first focusable element */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-[var(--card-bg)] focus:text-[var(--text-primary)] focus:px-4 focus:py-2 focus:rounded focus:border focus:border-[var(--accent)]"
        >
          Skip to main content
        </a>
        <main id="main-content" className="flex-grow">
          {children}
        </main>
        <Footer />
      </div>
    </PublicThemeWrapper>
  )
}
