import { CardSkeleton, TableSkeleton } from '@/app/components/ui'

export default function BossAssignmentsLoading() {
  return (
    <div className="space-y-6 p-4">
      <div className="h-8 w-56 animate-pulse rounded bg-[var(--bg-secondary)]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <TableSkeleton rows={6} columns={5} />
    </div>
  )
}
