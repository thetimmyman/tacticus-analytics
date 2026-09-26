'use client'

/** Kill / threshold / skip selector for a prime encounter. */
import clsx from 'clsx'
import { Ban, Crosshair, Gauge } from 'lucide-react'
import type { SideBehaviour } from '@/app/lib/boss-ops/encounter-ops-types'

export function BehaviourToggle({
  value,
  disabled,
  onChange
}: {
  value: SideBehaviour
  disabled: boolean
  onChange: (value: SideBehaviour) => void
}) {
  const options: Array<{
    value: SideBehaviour
    label: string
    Icon: typeof Crosshair
  }> = [
    { value: 'kill', label: 'Kill', Icon: Crosshair },
    { value: 'threshold', label: 'Threshold', Icon: Gauge },
    { value: 'skip', label: 'Skip', Icon: Ban }
  ]
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border border-[var(--card-border)] bg-black/20 p-1">
      {options.map(({ value: optionValue, label, Icon }) => {
        const active = value === optionValue
        return (
          <button
            key={optionValue}
            type="button"
            disabled={disabled}
            onClick={() => onChange(optionValue)}
            className={clsx(
              'inline-flex min-h-[34px] items-center justify-center gap-1 rounded border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              active
                ? optionValue === 'skip'
                  ? 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)]'
                  : optionValue === 'threshold'
                    ? 'border-[color-mix(in_srgb,var(--warning)_80%,transparent)] bg-[var(--warning-bg)] text-[var(--warning)]'
                    : 'border-[color-mix(in_srgb,var(--accent)_75%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--card-bg)_70%,transparent)] hover:text-[var(--text-primary)]'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
