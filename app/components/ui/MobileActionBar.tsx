'use client'

/**
 * Phone action bar. Sits above the bottom safe area and above the phone bottom
 * bar, so it does not cover the last section of the page it belongs to. Above
 * the `lg` breakpoint it renders as an ordinary inline row, so a page keeps one
 * action owner rather than two.
 *
 * Deliberate confirmations stay with their owner: this bar renders whatever
 * control it is given and never invents one.
 */

import type { ReactNode } from 'react'

export interface MobileActionBarProps {
  actions: ReactNode
  /** Label announced for the region. */
  label?: string
  className?: string
}

export function MobileActionBar({
  actions,
  label = 'Page actions',
  className = ''
}: MobileActionBarProps) {
  return (
    <div
      role="region"
      aria-label={label}
      data-testid="mobile-action-bar"
      className={`sticky bottom-[calc(var(--mobile-navigation-height)_+_env(safe-area-inset-bottom))] z-40 -mx-4 mb-[-1rem] flex flex-wrap items-center gap-2 border-t border-(--card-border) bg-(--card-bg) px-4 pt-2 pb-2 lg:static lg:mb-0 lg:border-t-0 lg:px-0 lg:py-0 ${className}`}
    >
      {actions}
    </div>
  )
}
