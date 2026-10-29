'use client'

/**
 * Shared phone card list. One card per row, complete title on its own line, and
 * the fields a decision actually uses. The rest of a row stays reachable on the
 * detail page or behind a disclosure rather than being clipped here.
 *
 * A card is a link or a button when the row can be opened; a row that cannot be
 * acted on is not given a control it will not honour.
 */

import Link from 'next/link'
import type { ReactNode } from 'react'

export interface MobileCardListItem {
  id: string
  /** Complete title. It wraps; it is not ellipsised. */
  title: ReactNode
  /** Short state line. Carries meaning without relying on colour alone. */
  state?: ReactNode
  /** Supporting detail, shown under the title. */
  detail?: ReactNode
  /** Metadata row — counts, sources, timestamps. */
  meta?: ReactNode[]
  /** Trailing control. A linked card cannot nest a control, so it sits below the link. */
  action?: ReactNode
  /** When set, the whole card becomes a link. */
  href?: string
}

export interface MobileCardListProps {
  items: MobileCardListItem[]
  /** Rendered when `items` is empty. Pass the state the page actually observed. */
  empty?: ReactNode
  className?: string
}

export function MobileCardList({
  items,
  empty,
  className = ''
}: MobileCardListProps) {
  if (items.length === 0) return <>{empty ?? null}</>

  return (
    <ul className={`space-y-2 ${className}`} data-testid="mobile-card-list">
      {items.map((item) => {
        const body = (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 text-sm font-semibold break-words">
                {item.title}
              </div>
              {item.state && (
                <span className="shrink-0 text-xs font-semibold">
                  {item.state}
                </span>
              )}
            </div>
            {item.detail && (
              <div className="mt-1 text-sm break-words">{item.detail}</div>
            )}
            {item.meta && item.meta.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {item.meta.map((entry, index) => (
                  <span key={index}>{entry}</span>
                ))}
              </div>
            )}
          </>
        )

        return (
          <li key={item.id} className="min-w-0">
            {item.href ? (
              <>
                <Link
                  href={item.href}
                  className="block min-h-[44px] rounded-lg border border-(--card-border) bg-(--card-bg) p-3"
                >
                  {body}
                </Link>
                {item.action && (
                  <div className="mt-2 [&_button]:min-h-11 [&_button]:min-w-11">
                    {item.action}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-(--card-border) bg-(--card-bg) p-3">
                {body}
                {item.action && (
                  <div className="mt-2 [&_button]:min-h-11 [&_button]:min-w-11">
                    {item.action}
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
