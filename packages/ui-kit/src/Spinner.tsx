import { Loader2 } from 'lucide-react'
import clsx from 'clsx'

export type SpinnerSize = 'sm' | 'md' | 'lg'

const sizeClass: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8'
}

export interface SpinnerProps {
  size?: SpinnerSize
  /** Accessible label announced by screen readers. Defaults to "Loading". */
  label?: string
  className?: string
}

export function Spinner({
  size = 'md',
  label = 'Loading',
  className
}: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={clsx(
        'animate-spin text-(--accent)',
        sizeClass[size],
        className
      )}
    />
  )
}
