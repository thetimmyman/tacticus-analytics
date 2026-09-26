import type { ReactNode } from 'react'
import clsx from 'clsx'

interface SectionLabelProps {
  children: ReactNode
  helper?: ReactNode
  /** Dotted divider beneath (default true). */
  withDivider?: boolean
  className?: string
}

export function SectionLabel({
  children,
  helper,
  withDivider = true,
  className
}: SectionLabelProps) {
  return (
    <div
      className={clsx(
        // Stacked on narrow screens so long helper text cannot overflow; inline from `sm:`.
        'flex flex-col gap-1',
        'sm:flex-row sm:items-baseline sm:justify-between sm:gap-3',
        withDivider &&
          'border-b border-dotted border-[var(--card-border)] pb-1.5',
        className
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
        {children}
      </span>
      {helper && (
        <span className="min-w-0 text-xs text-[var(--text-secondary)] italic sm:text-right">
          {helper}
        </span>
      )}
    </div>
  )
}
