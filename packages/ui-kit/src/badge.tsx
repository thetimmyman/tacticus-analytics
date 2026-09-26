import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type BadgeVariant = 'default' | 'secondary' | 'warning' | 'destructive'

const variantStyles: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-muted text-muted-foreground',
  warning: 'border-transparent bg-amber-500/15 text-amber-600',
  destructive: 'border-transparent bg-destructive text-destructive-foreground'
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variantStyles[variant] ?? variantStyles.default,
        className
      )}
      {...props}
    />
  )
}
