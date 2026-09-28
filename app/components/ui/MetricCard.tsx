import type { ReactNode } from 'react'
import clsx from 'clsx'

type MetricCardTone = 'default' | 'accent' | 'success' | 'warning' | 'danger'

const toneValueClass: Record<MetricCardTone, string> = {
  default: 'text-primary-wh40k',
  accent: 'text-(--accent)',
  success: 'text-(--success)',
  warning: 'text-(--warning)',
  danger: 'text-(--danger)'
}

interface MetricCardProps {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: MetricCardTone
  /** Custom Tailwind tone class; wins over `tone`. */
  valueClassName?: string
  className?: string
}

export function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
  valueClassName,
  className
}: MetricCardProps) {
  return (
    <div
      className={clsx(
        'rounded-md border border-(--card-border) bg-(--bg-primary) p-5 space-y-2',
        className
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-secondary-wh40k">
        {label}
      </div>
      <div
        className={clsx(
          'text-2xl font-bold',
          valueClassName ?? toneValueClass[tone]
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-(--text-tertiary)">{hint}</div>}
    </div>
  )
}
