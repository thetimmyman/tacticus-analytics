import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Info, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react'
import clsx from 'clsx'

export type InlineAlertTone = 'info' | 'warning' | 'success' | 'danger'

const toneClass: Record<
  InlineAlertTone,
  { wrap: string; icon: string; title: string; body: string }
> = {
  info: {
    wrap: 'border-[color-mix(in_srgb,var(--info)_40%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)]',
    icon: 'text-[var(--info)]',
    title: 'text-[var(--text-primary)]',
    body: 'text-[var(--text-secondary)]'
  },
  warning: {
    wrap: 'border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]',
    icon: 'text-[var(--warning)]',
    title: 'text-[var(--text-primary)]',
    body: 'text-[var(--text-secondary)]'
  },
  success: {
    wrap: 'border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)]',
    icon: 'text-[var(--success)]',
    title: 'text-[var(--text-primary)]',
    body: 'text-[var(--text-secondary)]'
  },
  danger: {
    wrap: 'border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
    icon: 'text-[var(--danger)]',
    title: 'text-[var(--text-primary)]',
    body: 'text-[var(--text-secondary)]'
  }
}

const toneIcon: Record<InlineAlertTone, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle,
  danger: AlertCircle
}

interface InlineAlertProps {
  tone?: InlineAlertTone
  title?: ReactNode
  children?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  /** Defaults to `status` (polite); pass `alert` for live regions. */
  role?: 'status' | 'alert'
  className?: string
}

export function InlineAlert({
  tone = 'info',
  title,
  children,
  icon,
  action,
  role = 'status',
  className
}: InlineAlertProps) {
  const ToneIcon = icon ?? toneIcon[tone]
  const tones = toneClass[tone]
  return (
    <div
      role={role}
      className={clsx(
        'rounded-md border p-3 text-xs leading-relaxed',
        tones.wrap,
        className
      )}
    >
      <div className="flex items-start gap-2">
        <ToneIcon
          className={clsx('h-4 w-4 flex-shrink-0 mt-0.5', tones.icon)}
          aria-hidden="true"
        />
        <div className="flex-1 space-y-1">
          {title && <p className={clsx('font-medium', tones.title)}>{title}</p>}
          {children && <div className={tones.body}>{children}</div>}
          {action && <div className="pt-1">{action}</div>}
        </div>
      </div>
    </div>
  )
}
