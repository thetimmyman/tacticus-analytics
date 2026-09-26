'use client'

import { Badge } from '@tacticus/ui-kit'

export default function WarPageHeader({
  title,
  description,
  badgeLabel
}: {
  title: string
  description?: string
  badgeLabel?: string
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          {title}
        </h1>
        {badgeLabel ? (
          <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)]">
            {badgeLabel}
          </Badge>
        ) : null}
      </div>
      {description ? (
        <p className="text-sm text-[var(--text-secondary)] mt-2">
          {description}
        </p>
      ) : null}
    </div>
  )
}
