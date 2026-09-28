import { Metadata } from 'next'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import Script from 'next/script'
import Link from 'next/link'
import {
  Heart,
  Coffee,
  GitBranch,
  MessageCircle,
  Server,
  Wrench
} from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Support the Creator | Tacticus Analytics',
  description:
    'Tacticus Analytics is 100% free. If you find it useful, you can leave a tip via Buy Me a Coffee or Patreon — purely optional.',
  openGraph: {
    title: 'Support the Creator | Tacticus Analytics',
    description:
      'Tacticus Analytics is 100% free. If you find it useful, you can leave a tip via Buy Me a Coffee or Patreon — purely optional.',
    type: 'website'
  }
}

export default async function SupportCreatorPage() {
  const authData = await getAuthUser()

  return (
    <div className="min-h-screen bg-linear-to-b from-(--bg-from) via-(--bg-via) to-(--bg-to)">
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5 pointer-events-none"></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-(--accent) to-transparent"></div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] mb-6">
            <Heart className="h-4 w-4 text-(--accent)" />
            <span className="text-sm text-(--accent) font-medium">Tip Jar</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-linear-to-r from-(--accent) to-(--primary) mb-6">
            Support the Creator
          </h1>
          <p className="text-xl text-secondary-wh40k max-w-3xl mx-auto leading-relaxed">
            Tacticus Analytics is a passion project built for the community.
            Your support helps cover server costs and keeps development going.
          </p>
          <p className="mt-4 text-sm text-(--text-tertiary) max-w-2xl mx-auto">
            Support is purely optional — every feature on this site is free for
            everyone.
          </p>
        </div>

        {/* Quick Support - Buy Me a Coffee */}
        <div className="mb-12">
          <div className="bg-linear-to-r from-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] to-(--card-bg) rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] p-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="text-center md:text-left">
                <div className="flex items-center gap-3 justify-center md:justify-start mb-4">
                  <Coffee className="h-8 w-8 text-amber-400" />
                  <h2 className="text-2xl md:text-3xl font-bold text-primary-wh40k">
                    Buy Me a Coffee
                  </h2>
                </div>
                <p className="text-secondary-wh40k max-w-xl">
                  One-time tip. Quick, no signup, no commitment.
                </p>
              </div>
              <div className="shrink-0">
                <a
                  href="https://www.buymeacoffee.com/TimmyMan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block hover:scale-105 transition-transform duration-200"
                >
                  <img
                    src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&slug=TimmyMan&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff"
                    alt="Buy Me A Coffee"
                    className="h-14"
                  />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Patreon Section — single button, no tier ladder */}
        <div className="mb-12">
          <div className="bg-linear-to-r from-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] to-(--card-bg) rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] p-8 text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-primary-wh40k mb-3">
              Prefer recurring support?
            </h2>
            <p className="text-secondary-wh40k max-w-2xl mx-auto mb-6">
              If you&apos;d like to support development on a recurring basis,
              here&apos;s the Patreon page. No tiers, no exclusive features —
              just a way to chip in if you want to.
            </p>
            <a
              href="https://www.patreon.com/c/thetimmyman"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 bg-linear-to-r from-[#FF424D] to-[#FF6B6B] hover:brightness-110 text-white font-semibold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.386.524c-4.764 0-8.64 3.876-8.64 8.64 0 4.75 3.876 8.613 8.64 8.613 4.75 0 8.614-3.864 8.614-8.613C24 4.4 20.136.524 15.386.524M.003 23.537h4.22V.524H.003" />
              </svg>
              Visit Patreon
            </a>
          </div>
        </div>

        {/* What Your Support Enables */}
        <div className="mb-12">
          <div className="bg-linear-to-r from-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] to-(--card-bg) rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] p-8">
            <h2 className="text-2xl md:text-3xl font-bold text-(--accent) mb-8 text-center">
              What Your Support Enables
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="text-center p-4">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] flex items-center justify-center">
                  <Server className="h-6 w-6 text-(--accent)" />
                </div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Server Costs
                </h3>
                <p className="text-sm text-secondary-wh40k">
                  Keep the site fast and reliable for everyone
                </p>
              </div>

              <div className="text-center p-4">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] flex items-center justify-center">
                  <GitBranch className="h-6 w-6 text-(--accent)" />
                </div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Roadmap Work
                </h3>
                <p className="text-sm text-secondary-wh40k">
                  Build and test the next guild raid workflows
                </p>
              </div>

              <div className="text-center p-4">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] flex items-center justify-center">
                  <Wrench className="h-6 w-6 text-(--accent)" />
                </div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Maintenance
                </h3>
                <p className="text-sm text-secondary-wh40k">
                  Bug fixes and keeping up with game updates
                </p>
              </div>

              <div className="text-center p-4">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] flex items-center justify-center">
                  <MessageCircle className="h-6 w-6 text-(--accent)" />
                </div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Community
                </h3>
                <p className="text-sm text-secondary-wh40k">
                  Discord bots, integrations, and more
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Community Links */}
        <div className="text-center">
          <h3 className="text-xl font-semibold text-(--accent) mb-4">
            Other Ways to Support
          </h3>
          <p className="text-secondary-wh40k mb-6 max-w-2xl mx-auto">
            Can&apos;t contribute financially? No worries — spreading the word,
            reporting bugs, suggesting features, or just being an active
            community member all help.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-6">
            <Link
              href="https://discord.gg/vd9Htx6Xs4"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg font-medium transition-colors"
            >
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Join our Discord
            </Link>
          </div>
        </div>
      </div>

      {/* Buy Me a Coffee Widget */}
      <Script
        src="https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js"
        data-name="BMC-Widget"
        data-cfasync="false"
        data-id="TimmyMan"
        data-description="Support me on Buy me a coffee!"
        data-message=""
        data-color="#5F7FFF"
        data-position="Right"
        data-x_margin="18"
        data-y_margin="18"
        strategy="lazyOnload"
      />
    </div>
  )
}
