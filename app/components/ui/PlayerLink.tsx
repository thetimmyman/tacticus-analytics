'use client'

import Link from 'next/link'
import {
  isValidElement,
  cloneElement,
  type ReactNode,
  type ReactElement
} from 'react'
import { usePathname } from 'next/navigation'
import { useMemberLabels } from '@/app/hooks/useMemberLabels'

interface PlayerLinkProps {
  playerName: string
  className?: string
  children?: React.ReactNode
}

export function PlayerLink({
  playerName,
  className = '',
  children
}: PlayerLinkProps) {
  const pathname = usePathname()
  const { labelFor } = useMemberLabels()

  // Show the friendly label ("SharedName (GUILD_B)"); href and tooltip keep the raw
  // playerName so `?search=` resolves. Only plain-string children are relabelled.
  const friendlyLabel = labelFor(playerName)
  const relabel = (node: ReactNode): ReactNode => {
    if (node == null) return friendlyLabel
    // Resolve by lookup key: callers often abbreviate the visible name.
    if (friendlyLabel === playerName) return node
    if (typeof node === 'string') return friendlyLabel
    if (isValidElement(node)) {
      const el = node as ReactElement<{ children?: ReactNode }>
      if (typeof el.props.children === 'string') {
        return cloneElement(el, {}, friendlyLabel)
      }
    }
    return node
  }
  const labelledText = relabel(children)

  if (pathname === '/player-stats' || pathname === '/guild-ops/player-lookup') {
    return <span className={className}>{labelledText}</span>
  }

  return (
    <Link
      href={`/player-stats?search=${encodeURIComponent(playerName)}`}
      className={`hover:underline hover:text-[var(--accent)] transition-colors ${className}`}
      title={`View stats for ${friendlyLabel}`}
    >
      {labelledText}
    </Link>
  )
}
