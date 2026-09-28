import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import clsx from 'clsx'

export interface EmptyStateProps {
  icon?: LucideIcon
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  /** Defaults to `md`. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClass = {
  sm: 'p-4 gap-2',
  md: 'p-8 gap-3',
  lg: 'p-12 gap-4'
} as const

export function EmptyState({
  icon: EmptyIcon,
  title,
  children,
  action,
  size = 'md',
  className
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center text-secondary-wh40k',
        sizeClass[size],
        className
      )}
    >
      {EmptyIcon && (
        <EmptyIcon
          className="h-8 w-8 text-(--text-tertiary)"
          aria-hidden="true"
        />
      )}
      {title && (
        <p className="text-sm font-medium text-primary-wh40k">{title}</p>
      )}
      {children && <div className="text-sm">{children}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
