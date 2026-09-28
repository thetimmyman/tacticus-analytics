'use client'

import Link from 'next/link'
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

export function PublicNav({ guildThemeData }: PublicNavProps) {
  return (
    <nav className="bg-black/60 backdrop-blur-xs border-b border-(--card-border) sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="shrink-0 flex items-center">
              {guildThemeData?.logo_url ? (
                <img
                  src={guildThemeData.logo_url}
                  alt={guildThemeData.display_name}
                  className="w-8 h-8"
                />
              ) : (
                <AnalyticsIcon className="w-8 h-8 text-(--primary)" />
              )}
              <span
                className="ml-2 text-xl font-bold font-mono tracking-tight hidden sm:inline"
                style={{ color: 'var(--primary)' }}
              >
                Tacticus Analytics
              </span>
              <span className="ml-1.5 text-sm font-bold font-mono text-(--primary) sm:hidden">
                Tacticus Analytics
              </span>
            </Link>
          </div>
          <div className="hidden md:flex items-center space-x-4">
            <Link
              href="/explore"
              className="text-primary-wh40k hover:text-(--primary) px-3 py-2 rounded-md text-sm font-medium transition-all duration-200"
            >
              Explore
            </Link>
            <DiscordNavButton />
            <Link
              href="/auth/login"
              className="bg-linear-to-r from-(--primary) to-(--accent) hover:brightness-110 text-(--bg-primary) px-4 py-2 rounded-md text-sm font-bold transition-all duration-200 border border-[color-mix(in_srgb,var(--primary)_50%,transparent)] font-mono tracking-wide shadow-lg shadow-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
            >
              Login
            </Link>
            <Link
              href="/auth/signup"
              className="bg-black/40 backdrop-blur-xs hover:bg-black/60 text-primary-wh40k border border-(--card-border) hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] px-4 py-2 rounded-md text-sm font-bold transition-all duration-200 font-mono tracking-wide"
            >
              Join
            </Link>
          </div>
          <div className="flex md:hidden items-center space-x-2">
            <Link
              href="/auth/login"
              className="bg-linear-to-r from-(--primary) to-(--accent) hover:brightness-110 text-(--bg-primary) px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 border border-[color-mix(in_srgb,var(--primary)_50%,transparent)] font-mono tracking-wide"
            >
              Login
            </Link>
            <Link
              href="/auth/signup"
              className="bg-black/40 backdrop-blur-xs hover:bg-black/60 text-primary-wh40k border border-(--card-border) hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 font-mono tracking-wide"
            >
              Join
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
