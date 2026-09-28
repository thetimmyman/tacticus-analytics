'use client'

import React from 'react'

type StatusType =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'online'
  | 'offline'
  | 'away'
  | 'busy'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'new'
  | 'in_progress'
  | 'completed'
  | 'muted'

type BadgeSize = 'xs' | 'sm' | 'md' | 'lg'

interface StatusLabelProps {
  type: StatusType
  children: React.ReactNode
  size?: BadgeSize
  className?: string
  pulse?: boolean
}

const typeStyles: Record<StatusType, string> = {
  active:
    'bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-(--success) border-[color-mix(in_srgb,var(--success)_30%,transparent)]',
  inactive: 'bg-(--card-bg) text-secondary-wh40k border-(--card-border)',
  pending:
    'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-(--warning) border-[color-mix(in_srgb,var(--warning)_30%,transparent)]',
  approved:
    'bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-(--success) border-[color-mix(in_srgb,var(--success)_30%,transparent)]',
  rejected:
    'bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] text-(--danger) border-[color-mix(in_srgb,var(--danger)_30%,transparent)]',

  online:
    'bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-(--success) border-[color-mix(in_srgb,var(--success)_30%,transparent)]',
  offline: 'bg-(--card-bg) text-secondary-wh40k border-(--card-border)',
  away: 'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-(--warning) border-[color-mix(in_srgb,var(--warning)_30%,transparent)]',
  busy: 'bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] text-(--danger) border-[color-mix(in_srgb,var(--danger)_30%,transparent)]',

  success:
    'bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-(--success) border-[color-mix(in_srgb,var(--success)_30%,transparent)]',
  error:
    'bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] text-(--danger) border-[color-mix(in_srgb,var(--danger)_30%,transparent)]',
  warning:
    'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-(--warning) border-[color-mix(in_srgb,var(--warning)_30%,transparent)]',
  info: 'bg-[color-mix(in_srgb,var(--info)_20%,transparent)] text-(--info) border-[color-mix(in_srgb,var(--info)_30%,transparent)]',

  new: 'bg-[color-mix(in_srgb,var(--info)_20%,transparent)] text-(--info) border-[color-mix(in_srgb,var(--info)_30%,transparent)]',
  in_progress:
    'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-(--warning) border-[color-mix(in_srgb,var(--warning)_30%,transparent)]',
  completed:
    'bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-(--success) border-[color-mix(in_srgb,var(--success)_30%,transparent)]',

  muted: 'bg-(--card-bg) text-secondary-wh40k border-(--card-border)'
}

const sizeStyles: Record<BadgeSize, string> = {
  xs: 'text-xs px-2 py-0.5',
  sm: 'text-sm px-2.5 py-1',
  md: 'text-base px-3 py-1.5',
  lg: 'text-lg px-4 py-2'
}

export function StatusLabel({
  type,
  children,
  size = 'sm',
  className = '',
  pulse = false
}: StatusLabelProps) {
  return (
    <span
      className={`
      inline-flex items-center gap-1.5 
      font-medium rounded-full border
      transition-all duration-200
      ${typeStyles[type]}
      ${sizeStyles[size]}
      ${pulse ? 'animate-pulse' : ''}
      ${className}
    `}
    >
      {children}
    </span>
  )
}

interface StatusDotProps {
  status:
    | 'online'
    | 'offline'
    | 'away'
    | 'busy'
    | 'active'
    | 'inactive'
    | 'warning'
    | 'error'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  pulse?: boolean
  title?: string
}

const dotColors: Record<StatusDotProps['status'], string> = {
  online: 'bg-(--success)',
  active: 'bg-(--success)',
  offline: 'bg-(--text-secondary)',
  inactive: 'bg-(--text-secondary)',
  away: 'bg-(--warning)',
  warning: 'bg-(--warning)',
  busy: 'bg-(--danger)',
  error: 'bg-(--danger)'
}

const dotSizes = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-3 h-3',
  lg: 'w-4 h-4'
}

export function StatusDot({
  status,
  size = 'sm',
  pulse = false,
  title
}: StatusDotProps) {
  return (
    <span
      className={`
        inline-block rounded-full
        ${dotColors[status]}
        ${dotSizes[size]}
        ${pulse ? 'animate-pulse' : ''}
      `}
      title={title}
    />
  )
}

interface ConnectionStatusProps {
  status: 'connected' | 'disconnected' | 'connecting' | 'error'
  showLabel?: boolean
  size?: BadgeSize
}

export function ConnectionStatus({
  status,
  showLabel = true,
  size = 'sm'
}: ConnectionStatusProps) {
  const configs: Record<
    ConnectionStatusProps['status'],
    { dot: StatusDotProps['status']; label: string; type: StatusType }
  > = {
    connected: { dot: 'online', label: 'Connected', type: 'success' },
    disconnected: { dot: 'offline', label: 'Disconnected', type: 'inactive' },
    connecting: { dot: 'away', label: 'Connecting...', type: 'pending' },
    error: { dot: 'error', label: 'Error', type: 'error' }
  }

  const config = configs[status]

  if (!showLabel) {
    return (
      <StatusDot
        status={config.dot}
        size={size}
        pulse={status === 'connecting'}
      />
    )
  }

  return (
    <StatusLabel type={config.type} size={size}>
      <StatusDot
        status={config.dot}
        size="xs"
        pulse={status === 'connecting'}
      />
      {config.label}
    </StatusLabel>
  )
}

interface SyncStatusProps {
  status: 'idle' | 'syncing' | 'success' | 'error'
  lastSync?: Date | null
  size?: BadgeSize
}

export function SyncStatus({ status, lastSync, size = 'sm' }: SyncStatusProps) {
  const configs = {
    idle: { type: 'inactive' as StatusType, label: 'Not synced' },
    syncing: { type: 'pending' as StatusType, label: 'Syncing...' },
    success: {
      type: 'success' as StatusType,
      label: lastSync ? `Synced ${formatRelativeTime(lastSync)}` : 'Synced'
    },
    error: { type: 'error' as StatusType, label: 'Sync failed' }
  }

  const config = configs[status]

  return (
    <StatusLabel type={config.type} size={size} pulse={status === 'syncing'}>
      {config.label}
    </StatusLabel>
  )
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
