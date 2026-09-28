import { CardSkeleton, TableSkeleton } from '@/app/components/ui'

// /home blocks on sequential fetch waves (up to 7s each); mirrors the Command Briefing fold.
export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
      <div className="h-10 w-full animate-pulse rounded-lg bg-(--bg-secondary)" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <TableSkeleton rows={5} columns={4} />
    </div>
  )
}
