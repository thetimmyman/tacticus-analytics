'use client'

import { useMemo } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import clsx from 'clsx'

interface SnapPointSliderProps {
  /** Sorted ascending selectable values. */
  snaps: number[]
  value: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
  formatSnap?: (snap: number) => string
  /** Reverse order, e.g. HP-remaining framing where 100 is leftmost. */
  reverse?: boolean
  /** `accent` follows the guild theme; `amber` is a universal warning. */
  accent?: 'amber' | 'accent'
  disabled?: boolean
  className?: string
  ariaLabel?: string
  ariaDescribedBy?: string
}

const accentByVariant = {
  amber: {
    fill: 'from-[var(--accent)] to-[var(--warning)]',
    dotActive:
      'bg-[var(--warning)] ring-[color-mix(in_srgb,var(--warning)_40%,transparent)]',
    readout: 'text-[var(--warning)]'
  },
  accent: {
    fill: 'from-[color-mix(in_srgb,var(--accent)_60%,transparent)] to-[var(--accent)]',
    dotActive:
      'bg-[var(--accent)] ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]',
    readout: 'text-[var(--accent)]'
  }
}

export function SnapPointSlider({
  snaps,
  value,
  onChange,
  formatValue = (v) => `${v}%`,
  formatSnap = (s) => String(s),
  reverse = false,
  accent = 'amber',
  disabled = false,
  className,
  ariaLabel = 'Threshold selection',
  ariaDescribedBy
}: SnapPointSliderProps) {
  const ordered = useMemo(
    () => (reverse ? [...snaps].reverse() : snaps),
    [snaps, reverse]
  )
  const selectedIndex = ordered.indexOf(value)
  const styles = accentByVariant[accent]
  const fillPercent =
    selectedIndex < 0 || ordered.length <= 1
      ? 0
      : (selectedIndex / (ordered.length - 1)) * 100
  const currentIndex = selectedIndex < 0 ? 0 : selectedIndex

  const setIndex = (index: number) => {
    if (disabled || ordered.length === 0) return
    const boundedIndex = Math.max(0, Math.min(index, ordered.length - 1))
    const nextValue = ordered[boundedIndex]
    if (nextValue !== undefined && nextValue !== value) {
      onChange(nextValue)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex(currentIndex + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex(currentIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setIndex(ordered.length - 1)
    }
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || ordered.length <= 1) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / bounds.width
    setIndex(Math.round(ratio * (ordered.length - 1)))
  }

  return (
    <div className={clsx('flex w-full min-w-0 items-center gap-3', className)}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={Math.min(...snaps)}
        aria-valuemax={Math.max(...snaps)}
        aria-valuenow={value}
        aria-valuetext={formatValue(value)}
        aria-disabled={disabled || undefined}
        aria-describedby={ariaDescribedBy}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        className={clsx(
          'relative min-h-[44px] flex-1 min-w-0 cursor-pointer touch-manipulation py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        {/* Track background */}
        <div className="relative h-1 rounded-full bg-[var(--card-border)]">
          {/* Filled portion with gradient */}
          <div
            className={clsx(
              'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r',
              styles.fill
            )}
            style={{ width: `${fillPercent}%` }}
          />
        </div>

        {/* Snap dots */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none">
          {ordered.map((snap, i) => {
            const isActive = i === selectedIndex
            const isPassed = i < selectedIndex
            const left =
              ordered.length <= 1 ? 0 : (i / (ordered.length - 1)) * 100
            return (
              <span
                key={snap}
                className="absolute flex h-11 w-11 -translate-x-1/2 items-center justify-center"
                style={{ left: `${left}%` }}
                aria-hidden="true"
              >
                <span
                  className={clsx(
                    'rounded-full ring-2 ring-transparent transition-all',
                    isActive
                      ? clsx('h-4 w-4 ring-4', styles.dotActive)
                      : isPassed
                        ? 'h-2.5 w-2.5 bg-[var(--accent)]'
                        : 'h-2.5 w-2.5 bg-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)]'
                  )}
                />
              </span>
            )
          })}
        </div>

        {/* Snap labels */}
        <div className="relative mt-4 hidden h-4 text-xs font-mono text-[color-mix(in_srgb,var(--text-secondary)_70%,transparent)] sm:block">
          {ordered.map((snap, i) => {
            const left =
              ordered.length <= 1 ? 0 : (i / (ordered.length - 1)) * 100
            return (
              <span
                key={snap}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${left}%` }}
              >
                {formatSnap(snap)}
              </span>
            )
          })}
        </div>
      </div>

      {/* Value readout */}
      <span
        className={clsx(
          'flex-shrink-0 whitespace-nowrap font-mono text-sm font-bold tabular-nums sm:text-lg',
          styles.readout
        )}
      >
        {formatValue(value)}
      </span>
    </div>
  )
}
