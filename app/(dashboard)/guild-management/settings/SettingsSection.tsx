'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/app/lib/utils/cn'

type SectionTone = 'default' | 'accent' | 'warning' | 'success' | 'danger'

const toneDecorations: Record<SectionTone, string> = {
  default:
    'border-card-border/80 from-[color-mix(in_srgb,var(--card-bg)_90%,transparent)] via-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] to-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)]',
  accent:
    'border-[color-mix(in_srgb,var(--accent)_40%,transparent)] from-[color-mix(in_srgb,var(--accent)_15%,transparent)] via-[color-mix(in_srgb,var(--accent)_5%,transparent)] to-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)]',
  warning:
    'border-amber-400/40 from-amber-500/10 via-amber-500/5 to-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]',
  success:
    'border-emerald-400/40 from-emerald-500/10 via-emerald-500/5 to-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]',
  danger:
    'border-red-500/40 from-red-600/15 via-red-600/10 to-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]'
}

interface SettingsSectionProps {
  id?: string
  title: string
  description?: string
  icon: LucideIcon
  tone?: SectionTone
  children: ReactNode
  headerActions?: ReactNode
  className?: string
}

export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  tone = 'default',
  children,
  headerActions,
  className
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        'rounded-3xl border backdrop-blur-md bg-gradient-to-br shadow-[0_18px_40px_rgba(4,8,20,0.45)] overflow-hidden',
        toneDecorations[tone],
        className
      )}
    >
      <div className="flex flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-2xl border bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] shadow-inner',
                tone === 'accent' &&
                  'border-[color-mix(in_srgb,var(--accent)_60%,transparent)] text-[var(--accent)]',
                tone === 'warning' && 'border-amber-400/60 text-amber-300',
                tone === 'success' && 'border-emerald-400/60 text-emerald-300',
                tone === 'danger' && 'border-red-500/60 text-red-300',
                tone === 'default' &&
                  'border-card-border/70 text-[var(--text-secondary)]'
              )}
            >
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                {title}
              </h2>
              {description && (
                <p className="mt-2 text-sm md:text-base text-[var(--text-secondary)] leading-relaxed">
                  {description}
                </p>
              )}
            </div>
          </div>
          {headerActions && (
            <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
              {headerActions}
            </div>
          )}
        </div>
        <div className="space-y-6 md:space-y-8">{children}</div>
      </div>
    </section>
  )
}
