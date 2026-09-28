'use client'

import { useId, type ReactNode } from 'react'
import clsx from 'clsx'

export type BarMeterTone = 'accent' | 'success' | 'warning' | 'danger' | 'info'

const toneFillClass: Record<BarMeterTone, string> = {
  accent: 'bg-accent-wh40k',
  success: 'bg-(--success)',
  warning: 'bg-(--warning)',
  danger: 'bg-(--danger)',
  info: 'bg-(--info)'
}

interface BarMeterProps {
  /** 0..100; clamped. */
  value: number
  label?: ReactNode
  /** Defaults to the visible label or percentage. */
  ariaLabel?: string
  meta?: ReactNode
  tone?: BarMeterTone
  animate?: boolean
  /** Shows the percentage inside the bar when it fits (default true). */
  showPercentage?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClass = {
  sm: 'h-2',
  md: 'h-3',
  lg: 'h-6'
} as const

export function BarMeter({
  value,
  label,
  ariaLabel,
  meta,
  tone = 'accent',
  animate = true,
  showPercentage = false,
  size = 'md',
  className
}: BarMeterProps) {
  const labelId = useId()
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const rounded = Math.round(clamped)
  const hasVisibleLabel = Boolean(label)
  return (
    <div className={clsx('space-y-1', className)}>
      {(label || meta) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <span id={labelId} className="font-medium text-primary-wh40k">
              {label}
            </span>
          )}
          {meta && <span className="text-secondary-wh40k">{meta}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-labelledby={hasVisibleLabel && !ariaLabel ? labelId : undefined}
        aria-label={
          !hasVisibleLabel || ariaLabel
            ? (ariaLabel ?? `Progress ${rounded}%`)
            : undefined
        }
        className={clsx(
          'w-full overflow-hidden rounded-full border border-(--card-border) bg-(--bg-secondary) relative',
          sizeClass[size]
        )}
      >
        <div
          className={clsx(
            'h-full transition-[width]',
            animate ? 'duration-slow ease-default' : 'duration-0',
            toneFillClass[tone]
          )}
          style={{ width: `${clamped}%` }}
        />
        {showPercentage && size === 'lg' && clamped > 5 && (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-primary-wh40k">
            {rounded}%
          </span>
        )}
      </div>
    </div>
  )
}
