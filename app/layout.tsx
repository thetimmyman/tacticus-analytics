import './globals.css'
import './styles/form-autofill.css'
import './styles/particle-effects.css'
import './performance-optimizations.css'
import './styles/interactions.css'
import './styles/boss-portrait.css'
import type { Metadata } from 'next'
import { Providers } from './providers'
import { ThemeScript } from '@/app/components/ThemeScript'
import {
  StructuredData,
  OrganizationStructuredData
} from '@/app/components/StructuredData'
import SelfHostSandboxBanner from '@/app/components/environment/SelfHostSandboxBanner'
import { DeploymentEnvironmentBanner } from '@/app/components/DeploymentEnvironmentBanner'
import { VersionChecker } from '@/app/components/VersionChecker'
import { headers } from 'next/headers'
import {
  getSupabaseHost,
  hasSupabaseCredentials
} from '@tacticus/app-core/supabase-env'
import { APP_ORIGINS, TACTICUS_API } from '@tacticus/app-core/app-config'

const hasSupabase = hasSupabaseCredentials()
const supabaseOrigin: string | undefined = hasSupabase
  ? `https://${getSupabaseHost()}`
  : undefined
const tacticusOrigin = TACTICUS_API.ORIGIN

const DOMAIN_URL = process.env.NEXT_PUBLIC_DOMAIN || APP_ORIGINS.CURRENT

export const metadata: Metadata = {
  metadataBase: new URL(DOMAIN_URL),
  title:
    'Tacticus Analytics | Professional Guild Raid Analytics for Warhammer 40,000: Tacticus',
  description:
    'Guild raid analytics for Tacticus teams. Track token availability in real time, analyze battle performance with 90+ metrics, review team compositions, and plan raid assignments.',
  keywords:
    'Tacticus Analytics, Warhammer 40000 Tacticus, guild raid tracker, token tracker, battle analytics, performance metrics, meta analysis, boss strategies, guild management, raid optimization, GR availability, VOTLW tracking, team composition, damage calculator, Tacticus tools',
  authors: [{ name: 'Tacticus Analytics Team' }],
  creator: 'Tacticus Analytics',
  publisher: 'Tacticus Analytics',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1
    }
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
    shortcut: '/favicon.svg'
  },
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: DOMAIN_URL,
    siteName: 'Tacticus Analytics',
    title: 'Tacticus Analytics - Professional Guild Raid Tracker',
    description:
      'Real-time token tracking, battle analytics, and meta analysis for Warhammer 40,000: Tacticus guild raids. Optimize your guild performance with data-driven insights.',
    images: [
      {
        url: `${DOMAIN_URL}/WarpForgedDashboard.png`,
        width: 1536,
        height: 1024,
        alt: 'Tacticus Analytics'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tacticus Analytics - Guild Raid Performance Tracker',
    description:
      'Track tokens, analyze battles, discover meta teams. The essential analytics platform for competitive Tacticus guilds.',
    images: [`${DOMAIN_URL}/WarpForgedDashboard.png`]
  },
  alternates: {
    canonical: DOMAIN_URL
  }
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const nonce = headersList.get('x-nonce') || undefined

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=5"
        />
        <meta name="theme-color" content="#dc2626" />
        {hasSupabase && <link rel="preconnect" href={supabaseOrigin} />}
        <link rel="preconnect" href={tacticusOrigin} />
        {hasSupabase && <link rel="dns-prefetch" href={supabaseOrigin} />}
        <link rel="dns-prefetch" href={tacticusOrigin} />
        <ThemeScript nonce={nonce} />
        <StructuredData />
        <OrganizationStructuredData />
      </head>
      <body
        className="bg-linear-to-br from-(--bg-from) via-(--bg-via) to-(--bg-to) min-h-screen"
        suppressHydrationWarning
      >
        <VersionChecker />
        <SelfHostSandboxBanner />
        <DeploymentEnvironmentBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
