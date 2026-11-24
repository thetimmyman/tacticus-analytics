'use client'

import { ChromeLink as Link } from './ChromeLink'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'
import { DiscordNavButton } from './DiscordNavButton'

interface GuildThemeData {
  guild_code: string
  display_name: string
  primary_color: string
  secondary_color: string
  accent_color: string
  logo_url?: string
  theme_name: string
}

interface PublicNavProps {
  guildThemeData?: GuildThemeData | null
}

/**
 * The bar paints its own opaque black surface, so it opts into
 * `scheme-dark` and fixed light label tiers: Light Mode and every guild
 * theme repaint the theme tokens it used to read from, which collapsed
 * Logo/Join/Explore contrast to 1.2-3.1:1. The Login CTA keeps its
 * theme-safe `--cta-*` gradient (the runtime tunes stops + on-cta label).
 */
export function PublicNav({ guildThemeData }: PublicNavProps) {
  return (
    <nav className="scheme-dark bg-black border-b border-white/10 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link
              href="/"
              aria-label="Tacticus Analytics"
              className="shrink-0 flex items-center"
            >
              {guildThemeData?.logo_url ? (
                <img
                  src={guildThemeData.logo_url}
                  alt={guildThemeData.display_name}
                  className="w-8 h-8"
                />
              ) : (
                <AnalyticsIcon className="w-8 h-8" />
              )}
              <span className="ml-2 text-xl font-bold font-mono tracking-tight text-white hidden sm:inline">
                Tacticus Analytics
              </span>
            </Link>
          </div>
          <div className="hidden md:flex items-center space-x-4">
            <Link
              href="/explore"
              className="text-gray-200 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-all duration-200"
            >
              Explore
            </Link>
            <DiscordNavButton />
            <Link
              href="/auth/login"
              className="bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) hover:from-(--cta-to) hover:to-(--cta-from) hover:filter-none hover:-translate-y-0.5 text-on-cta-wh40k px-4 py-2 rounded-md text-sm font-bold transition-all duration-200 border border-[color-mix(in_srgb,var(--primary)_50%,transparent)] font-mono tracking-wide shadow-lg shadow-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
            >
              Login
            </Link>
            <Link
              href="/auth/signup"
              className="text-gray-100 bg-white/10 hover:bg-white/20 border border-white/25 px-4 py-2 rounded-md text-sm font-bold transition-all duration-200 font-mono tracking-wide"
            >
              Join
            </Link>
          </div>
          <div className="flex md:hidden items-center space-x-2">
            <Link
              href="/explore"
              className="text-gray-200 hover:text-white px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
            >
              Explore
            </Link>
            <Link
              href="/auth/login"
              className="bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) hover:from-(--cta-to) hover:to-(--cta-from) hover:filter-none hover:-translate-y-0.5 text-on-cta-wh40k px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 border border-[color-mix(in_srgb,var(--primary)_50%,transparent)] font-mono tracking-wide"
            >
              Login
            </Link>
            <Link
              href="/auth/signup"
              className="text-gray-100 bg-white/10 hover:bg-white/20 border border-white/25 px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 font-mono tracking-wide"
            >
              Join
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
