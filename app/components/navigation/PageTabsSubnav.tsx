'use client'

// Tier-3 page tab rail below WorkspaceBar and SectionSubnav. Controlled; a tab
// with `href` renders as a Link and does not fire `onValueChange`.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/app/lib/utils/cn'

export interface PageTab {
  value: string
  label: string
  icon?: ReactNode
  badge?: ReactNode
  /** Renders as `next/link` instead of firing `onValueChange`; active state follows `value`. */
  href?: string
  disabled?: boolean
}

export interface PageTabsSubnavProps {
  tabs: PageTab[]
  value: string
  onValueChange?: (value: string) => void
  className?: string
  /** Default 'Page tabs'; override when several rails are mounted. */
  ariaLabel?: string
}

export function PageTabsSubnav({
  tabs,
  value,
  onValueChange,
  className,
  ariaLabel = 'Page tabs'
}: PageTabsSubnavProps) {
  if (tabs.length === 0) return null

  return (
    <div
      className={cn(
        'border-b border-(--card-border) overflow-x-auto scrollbar-hide',
        '-mx-4 px-4 md:mx-0 md:px-0',
        className
      )}
    >
      <nav
        aria-label={ariaLabel}
        className="-mb-px flex space-x-1 min-w-max"
        role="tablist"
      >
        {tabs.map((tab) => {
          const active = tab.value === value
          const baseCls = cn(
            'min-h-[44px] px-2.5 md:px-4 py-2 text-xs md:text-sm font-medium transition-colors duration-200',
            'border-b-2 whitespace-nowrap shrink-0 inline-flex items-center gap-2',
            active
              ? 'border-accent-wh40k text-(--accent)'
              : 'border-transparent text-secondary-wh40k hover:text-primary-wh40k hover:border-(--text-secondary)',
            tab.disabled && 'opacity-40 pointer-events-none'
          )

          const inner = (
            <>
              {tab.icon && (
                <span className="inline-flex items-center" aria-hidden>
                  {tab.icon}
                </span>
              )}
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={cn(
                    'ml-1 inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-bold leading-none uppercase tracking-wider',
                    active
                      ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-(--accent)'
                      : 'bg-(--card-bg) text-secondary-wh40k'
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </>
          )

          if (tab.href) {
            return (
              <Link
                key={tab.value}
                href={tab.href}
                className={baseCls}
                role="tab"
                aria-selected={active}
                aria-current={active ? 'page' : undefined}
                tabIndex={active ? 0 : -1}
                data-testid={`page-tab-${tab.value}`}
              >
                {inner}
              </Link>
            )
          }

          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => !tab.disabled && onValueChange?.(tab.value)}
              className={baseCls}
              role="tab"
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              tabIndex={active ? 0 : -1}
              disabled={tab.disabled}
              data-testid={`page-tab-${tab.value}`}
            >
              {inner}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
