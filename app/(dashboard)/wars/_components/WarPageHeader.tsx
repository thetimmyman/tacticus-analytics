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
        <h1 className="text-3xl font-bold text-primary-wh40k">{title}</h1>
        {badgeLabel ? (
          <Badge className="bg-(--bg-secondary) text-secondary-wh40k border-(--border)">
            {badgeLabel}
          </Badge>
        ) : null}
      </div>
      {description ? (
        <p className="text-sm text-secondary-wh40k mt-2">{description}</p>
      ) : null}
    </div>
  )
}
