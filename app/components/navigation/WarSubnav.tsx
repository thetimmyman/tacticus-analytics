'use client'

import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  RadixDropdownMenu,
  RadixDropdownMenuTrigger,
  RadixDropdownMenuContent
} from '@tacticus/ui-kit/radix-dropdown'
import { cn } from '@/app/lib/utils/cn'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import {
  warGlobalLinks,
  warDetailTabs,
  type NavItem,
  type WarSubnavMode
} from './config'

interface WarSubnavProps {
  mode: WarSubnavMode
  className?: string
}

export function WarSubnav({ mode, className }: WarSubnavProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSeason = searchParams.get('season')

  const warId = mode.kind === 'detail' ? mode.warId : null

  const links: NavItem[] = warId
    ? warDetailTabs.map((tab) => ({
        href: `/wars/${warId}${tab.suffix}`,
        label: tab.label,
        icon: tab.icon
      }))
    : warGlobalLinks

  const isLinkActive = (item: NavItem) => {
    const matchPath = item.activePrefix ?? item.href
    if (warId) {
      const base = `/wars/${warId}`
      if (matchPath === base) return pathname === base
      return pathname.startsWith(matchPath)
    }
    // Global mode: /wars matches exactly only for War Reports.
    if (matchPath === '/wars') return pathname === '/wars'
    return pathname.startsWith(matchPath)
  }

  const activeLink = links.find((item) => isLinkActive(item))
  const ActiveIcon = activeLink?.icon ?? links[0]?.icon

  const renderNavLink = (item: NavItem) => {
    const active = isLinkActive(item)
    const href = getHrefWithSeason(item.href, currentSeason)
    const Icon = item.icon

    return (
      <Link
        key={item.href}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          // Matches SectionSubnav's accent pill.
          'inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
          active
            ? 'border-[color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
            : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]'
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    )
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--card-border)] bg-card/70 p-3',
        className
      )}
    >
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)] font-mono mb-2">
        Guild War
      </p>

      {/* Desktop: horizontal chip rail */}
      <nav
        aria-label="Wars navigation"
        className="hidden md:block overflow-x-auto"
      >
        <div className="flex gap-2 min-w-max">{links.map(renderNavLink)}</div>
      </nav>

      {/* Mobile: compact dropdown */}
      <div className="md:hidden">
        <RadixDropdownMenu>
          <RadixDropdownMenuTrigger asChild>
            <button
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium w-full',
                'bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] text-[var(--bg-primary)]'
              )}
            >
              {ActiveIcon && (
                <ActiveIcon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="flex-1 text-left">
                {activeLink?.label ?? links[0]?.label ?? 'Navigate'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 ml-auto" />
            </button>
          </RadixDropdownMenuTrigger>
          <RadixDropdownMenuContent
            align="start"
            className="w-[calc(100vw-2.5rem)] max-w-sm"
          >
            <div className="flex flex-col gap-1 p-1">
              {links.map((item) => {
                const active = isLinkActive(item)
                const href = getHrefWithSeason(item.href, currentSeason)
                const Icon = item.icon

                return (
                  <Link
                    key={item.href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--accent)] font-medium'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]'
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {active && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                    )}
                  </Link>
                )
              })}
            </div>
          </RadixDropdownMenuContent>
        </RadixDropdownMenu>
      </div>
    </div>
  )
}
