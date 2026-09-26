'use client'

import { useState } from 'react'

interface AvatarProps {
  displayName: string
  guildCode?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  avatarUrl?: string | null
}

export function Avatar({
  displayName,
  guildCode,
  size = 'md',
  className = '',
  avatarUrl
}: AvatarProps) {
  const [imgError, setImgError] = useState(false)

  const initials = (displayName || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  }

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        data-guild-code={guildCode || undefined}
        className={`${sizeClasses[size]} rounded-full object-cover ${className}`}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div
      data-guild-code={guildCode || undefined}
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center font-bold text-[var(--bg-primary)] ${className}`}
    >
      {initials}
    </div>
  )
}
