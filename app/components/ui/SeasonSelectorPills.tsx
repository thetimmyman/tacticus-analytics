'use client'

import { ModeTogglePillGroup } from './ModeTogglePillGroup'

export interface SeasonOption {
  /** Consumer id, e.g. `'current'`, `'next'`, `'S102'`. */
  value: string
  label: string
  /** For unreachable past seasons. */
  disabled?: boolean
}

interface SeasonSelectorPillsProps {
  options: SeasonOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}

export function SeasonSelectorPills({
  options,
  value,
  onChange,
  className,
  ariaLabel = 'Season selector'
}: SeasonSelectorPillsProps) {
  return (
    <ModeTogglePillGroup
      options={options}
      value={value}
      onChange={onChange}
      className={className}
      ariaLabel={ariaLabel}
      appearance="plain"
      uppercase
    />
  )
}
