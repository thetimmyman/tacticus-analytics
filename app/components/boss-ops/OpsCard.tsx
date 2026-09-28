'use client'

import type { ReactNode } from 'react'
import { Settings2 } from 'lucide-react'

export function OpsCard({
  title,
  description,
  children,
  status
}: {
  title: string
  description?: string
  children: ReactNode
  status?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_75%,transparent)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary-wh40k">
            <Settings2 className="h-4 w-4 text-(--accent)" />
            {title}
          </div>
          {description && (
            <p className="mt-1 text-xs text-(--text-tertiary)">{description}</p>
          )}
        </div>
        {status}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  )
}
