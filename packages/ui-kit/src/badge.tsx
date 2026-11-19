import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type BadgeVariant =
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'

// Each variant names the theme's own tokens, so a pill is visible in every theme.
// Status colour is a tint behind the label; the label always states the status.
const variantStyles: Record<BadgeVariant, string> = {
  default: 'border-(--card-border) text-primary-wh40k',
  secondary: 'border-(--card-border) bg-(--bg-secondary) text-secondary-wh40k',
  success: 'border-(--success-border) bg-(--success-bg) text-primary-wh40k',
  warning: 'border-(--warning-border) bg-(--warning-bg) text-primary-wh40k',
  destructive: 'border-(--error-border) bg-(--error-bg) text-primary-wh40k'
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
