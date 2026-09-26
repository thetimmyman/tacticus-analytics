'use client'

import { useSyncExternalStore } from 'react'

function formatClientDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

interface ClientDateProps {
  date?: Date | string
  format?: 'smart' | 'relative' | 'battle' | 'sync' | 'full' | 'date' | 'time'
  className?: string
  title?: boolean
}

const subscribeToClientReady = (callback: () => void) => {
  callback()
  return () => {}
}

export function ClientDate({
  date,
  format = 'smart',
  className,
  title = true
}: ClientDateProps) {
  const mounted = useSyncExternalStore(
    subscribeToClientReady,
    () => true,
    () => false
  )

  if (!mounted) {
    return <span className={className}>&nbsp;</span>
  }

  const dateObj = date
    ? typeof date === 'string'
      ? new Date(date)
      : date
    : new Date()

  const formatted = (() => {
    switch (format) {
      case 'date':
        return dateObj.toLocaleDateString()
      case 'time':
        return dateObj.toLocaleTimeString()
      case 'full':
        return dateObj.toLocaleString()
      default:
        return formatClientDate(dateObj)
    }
  })()

  const titleText = title
    ? dateObj.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      })
    : undefined

  return (
    <span className={className} title={titleText}>
      {formatted}
    </span>
  )
}
