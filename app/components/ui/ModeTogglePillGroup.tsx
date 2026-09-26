'use client'

import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import clsx from 'clsx'

export type ModeAccent = 'accent' | 'amber' | 'neutral'

export interface ModeOption<T extends string> {
  value: T
  label: string
  /** Defaults to the group's `accent`. */
  accent?: ModeAccent
  disabled?: boolean
}

interface ModeTogglePillGroupProps<T extends string> {
  options: ModeOption<T>[]
  value: T
  onChange: (value: T) => void
  accent?: ModeAccent
  className?: string
  ariaLabel?: string
  disabled?: boolean
  compact?: boolean
  appearance?: 'grouped' | 'plain'
  uppercase?: boolean
}

const accentClassMap: Record<ModeAccent, string> = {
  accent:
    'border-[color-mix(in_srgb,var(--accent)_70%,transparent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]',
  amber: 'border-[var(--warning)] text-[var(--warning)] bg-[var(--warning-bg)]',
  neutral:
    'border-[var(--card-border)] text-[var(--text-primary)] bg-[var(--card-bg)]'
}

export function ModeTogglePillGroup<T extends string>({
  options,
  value,
  onChange,
  accent = 'accent',
  className,
  ariaLabel = 'Mode selection',
  disabled = false,
  compact = false,
  appearance = 'grouped',
  uppercase = false
}: ModeTogglePillGroupProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const enabledOptions = options.filter((opt) => !disabled && !opt.disabled)

  const selectOptionAt = (index: number) => {
    const next = enabledOptions[index]
    if (!next) return
    onChange(next.value)
    const originalIndex = options.findIndex((opt) => opt.value === next.value)
    window.requestAnimationFrame(() =>
      buttonRefs.current[originalIndex]?.focus()
    )
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabledOptions.length === 0) return

    const currentIndex = Math.max(
      0,
      enabledOptions.findIndex((opt) => opt.value === value)
    )

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      selectOptionAt((currentIndex + 1) % enabledOptions.length)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      selectOptionAt(
        (currentIndex - 1 + enabledOptions.length) % enabledOptions.length
      )
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectOptionAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectOptionAt(enabledOptions.length - 1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className={clsx(
        'inline-flex max-w-full flex-wrap gap-1',
        appearance === 'grouped'
          ? 'w-full min-w-0 items-stretch rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] sm:w-auto sm:items-center'
          : 'items-center',
        appearance === 'grouped' && (compact ? 'p-0.5' : 'p-1'),
        className
      )}
    >
      {options.map((opt, index) => {
        const isActive = opt.value === value
        const optAccent = opt.accent ?? accent
        return (
          <button
            key={opt.value}
            ref={(node) => {
              buttonRefs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive && !disabled && !opt.disabled ? 0 : -1}
            disabled={disabled || opt.disabled}
            onClick={() => !disabled && !opt.disabled && onChange(opt.value)}
            className={clsx(
              'min-w-[44px] flex-1 rounded-md text-xs font-semibold transition-colors',
              compact
                ? 'min-h-[34px] px-2 py-1 sm:px-3'
                : 'min-h-[44px] px-3 py-2 sm:px-4',
              uppercase && 'uppercase tracking-[0.12em]',
              'border',
              isActive
                ? accentClassMap[optAccent]
                : clsx(
                    'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                    appearance === 'plain' && 'hover:bg-[var(--card-bg)]'
                  ),
              (disabled || opt.disabled) && 'opacity-40 cursor-not-allowed'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
