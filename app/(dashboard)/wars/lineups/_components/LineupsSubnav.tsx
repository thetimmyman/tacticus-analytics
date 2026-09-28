'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ClipboardList, Shield, Sword, type LucideIcon } from 'lucide-react'
import { cn } from '@/app/lib/utils/cn'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import SideTogglePills from '../../_components/SideTogglePills'

interface LineupsSubnavItem {
  href: string
  label: string
  icon: LucideIcon
  prefixes: string[]
}

const ITEMS: LineupsSubnavItem[] = [
  {
    href: '/wars/lineups/offense',
    label: 'Compositions',
    icon: ClipboardList,
    prefixes: ['/wars/lineups/offense', '/wars/lineups/defense']
  },
  {
    href: '/wars/lineups/attackers',
    label: 'Offense Heroes',
    icon: Sword,
    prefixes: ['/wars/lineups/attackers']
  },
  {
    href: '/wars/lineups/defenders',
    label: 'Defense Heroes',
    icon: Shield,
    prefixes: ['/wars/lineups/defenders']
  }
]

export function LineupsSubnav() {
  const pathname = usePathname()
  const season = useSearchParams().get('season')

  // Only on Compositions; the hero tables are already per side.
  const compositionsSide = pathname.startsWith('/wars/lineups/defense')
    ? ('defense' as const)
    : pathname.startsWith('/wars/lineups/offense')
      ? ('offense' as const)
      : null

  return (
    <div
      data-testid="lineups-subnav-row"
      className="flex items-center gap-3 overflow-x-auto px-4 pt-4"
    >
      <nav aria-label="Lineups sections" className="flex shrink-0 gap-2">
        {ITEMS.map((item) => {
          const active = item.prefixes.some((p) => pathname.startsWith(p))
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={getHrefWithSeason(item.href, season)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                active
                  ? 'border-[color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-(--accent)'
                  : 'border-(--card-border) bg-(--card-bg) text-secondary-wh40k hover:text-primary-wh40k hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      {compositionsSide && (
        <div className="ml-auto shrink-0">
          <SideTogglePills
            active={compositionsSide}
            basePath="/wars/lineups"
            variant="segmented"
            season={season}
          />
        </div>
      )}
    </div>
  )
}
