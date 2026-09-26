'use client'

import type { ReactNode } from 'react'
import WarHeader from './WarHeader'
import { useWarInfo } from '../_hooks'
import { Skeleton } from '@tacticus/ui-kit'

function WarHeaderSkeleton() {
  return (
    <div className="border border-[var(--border)] rounded-lg bg-[var(--bg-primary)] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="grid grid-cols-3 items-center gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center gap-3 justify-end">
          <div className="space-y-2 text-right">
            <Skeleton className="h-4 w-16 ml-auto" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export default function WarLayoutClient({
  warId,
  children
}: {
  warId: string
  children: ReactNode
}) {
  const { data: warData, isLoading, error } = useWarInfo(warId)

  if (isLoading) {
    return (
      <div className="px-4 space-y-6">
        <WarHeaderSkeleton />
        {children}
      </div>
    )
  }

  if (error || !warData) {
    return (
      <div className="px-4 space-y-6">
        <div className="border border-[var(--border)] rounded-lg bg-[var(--bg-primary)] p-6 text-center">
          <p className="text-[var(--text-secondary)]">
            Failed to load war data. Please try again.
          </p>
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="px-4 space-y-6">
      <WarHeader war={warData} />
      {children}
    </div>
  )
}
