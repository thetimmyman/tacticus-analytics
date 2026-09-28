'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

interface BossLinkProps {
  bossName: string
  className?: string
  children?: React.ReactNode
  showPortrait?: boolean
  portraitSize?: 'small' | 'medium' | 'large'
  portraitVariant?: 'portrait' | 'icon' | 'thumbnail'
}

export function BossLink({
  bossName,
  className = '',
  children,
  showPortrait = false,
  portraitSize = 'small',
  portraitVariant = 'icon'
}: BossLinkProps) {
  const pathname = usePathname()

  // Curated name for label and tooltip; raw `bossName` still keys the portrait and /boss href.
  const displayName = getBossDisplayName(bossName)

  const content = (
    <span className={`flex items-center gap-2 ${className}`}>
      {showPortrait && (
        <BossPortrait
          bossName={bossName}
          size={portraitSize}
          variant={portraitVariant}
          showFallback={true}
        />
      )}
      <span>{children || displayName}</span>
    </span>
  )

  if (pathname === '/boss') {
    return content
  }

  return (
    <Link
      href={`/boss?boss=${encodeURIComponent(bossName)}`}
      className={`hover:underline hover:text-(--accent) transition-colors ${className}`}
      title={`View stats for ${displayName}`}
    >
      {content}
    </Link>
  )
}
