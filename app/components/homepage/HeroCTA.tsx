import Link from 'next/link'
import { DiscordButton } from '@tacticus/ui-kit/BrandButton'

interface HeroCTAProps {
  isAuthenticated: boolean
}

export function HeroCTA({ isAuthenticated: initialAuth }: HeroCTAProps) {
  if (initialAuth) {
    return (
      <>
        <Link
          href="/home"
          className="px-4 sm:px-6 md:px-8 py-2.5 sm:py-3 md:py-4 bg-linear-to-r from-(--primary) to-(--accent) hover:from-(--accent) hover:to-(--primary) text-black font-bold rounded-lg text-sm sm:text-base md:text-lg transition-all duration-300 hover:shadow-lg hover:shadow-[color-mix(in_srgb,var(--accent)_25%,transparent)] hover:scale-105"
        >
          Go to Dashboard →
        </Link>
        <Link
          href="/explore"
          className="px-4 sm:px-6 md:px-8 py-2.5 sm:py-3 md:py-4 bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] backdrop-blur-sm border border-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] text-primary-wh40k font-bold rounded-lg text-sm sm:text-base md:text-lg transition-all duration-300"
        >
          Explore Clusters
        </Link>
      </>
    )
  }

  return (
    <>
      <Link
        href="/explore"
        className="px-4 sm:px-6 md:px-8 py-2.5 sm:py-3 md:py-4 bg-linear-to-r from-(--primary) to-(--accent) hover:from-(--accent) hover:to-(--primary) text-black font-bold rounded-lg text-sm sm:text-base md:text-lg transition-all duration-300 hover:shadow-lg hover:shadow-[color-mix(in_srgb,var(--accent)_25%,transparent)] hover:scale-105"
      >
        Explore Clusters
      </Link>
      <DiscordButton
        as="a"
        href="https://discord.gg/vd9Htx6Xs4"
        target="_blank"
        rel="noopener noreferrer"
        className="px-4 sm:px-6 md:px-8 py-2.5 sm:py-3 md:py-4 font-bold rounded-lg text-sm sm:text-base md:text-lg transition-all duration-300 flex items-center justify-center gap-2"
        showIcon={true}
      >
        Join Discord
      </DiscordButton>
    </>
  )
}
