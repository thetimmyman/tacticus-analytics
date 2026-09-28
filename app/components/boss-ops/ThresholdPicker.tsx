'use client'

import clsx from 'clsx'
// Same snaps as clampThreshold(), so the picker never offers a value the writer rewrites.
import { THRESHOLD_SNAPS } from '@/app/lib/boss-ops/persistence'

export function ThresholdPicker({
  value,
  disabled,
  onChange
}: {
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {THRESHOLD_SNAPS.map((choice) => (
        <button
          key={choice}
          type="button"
          disabled={disabled}
          onClick={() => onChange(choice)}
          className={clsx(
            'rounded-md border px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40',
            value === choice
              ? 'border-[color-mix(in_srgb,var(--warning)_80%,transparent)] bg-(--warning-bg) text-(--warning)'
              : 'border-(--card-border) bg-black/15 text-secondary-wh40k hover:text-primary-wh40k'
          )}
        >
          {choice}%
        </button>
      ))}
    </div>
  )
}
