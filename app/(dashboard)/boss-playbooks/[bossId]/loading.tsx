import { Loader2 } from 'lucide-react'

export default function BossPlaybookDetailLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-5 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
        <div className="h-8 w-36 bg-[var(--bg-secondary)] rounded-md animate-pulse" />
      </div>

      <div className="card-wh40k p-3 h-10 animate-pulse bg-purple-500/5" />

      <div className="card-wh40k overflow-hidden">
        <div className="flex items-start gap-4 p-4 border-b border-[var(--card-border)]">
          <div className="h-20 w-20 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-48 bg-[var(--bg-secondary)] rounded animate-pulse" />
            <div className="h-4 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
            <div className="h-5 w-40 bg-[var(--bg-secondary)] rounded animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-[var(--card-border)]">
          <div className="p-3 flex flex-col items-center">
            <div className="h-4 w-12 bg-[var(--bg-secondary)] rounded animate-pulse mb-1" />
            <div className="h-6 w-8 bg-[var(--bg-secondary)] rounded animate-pulse" />
          </div>
          <div className="p-3 flex flex-col items-center">
            <div className="h-4 w-12 bg-[var(--bg-secondary)] rounded animate-pulse mb-1" />
            <div className="h-6 w-8 bg-[var(--bg-secondary)] rounded animate-pulse" />
          </div>
        </div>
      </div>

      <div className="card-wh40k p-4 space-y-3">
        <div className="h-5 w-36 bg-[var(--bg-secondary)] rounded animate-pulse" />
        <div className="flex flex-wrap gap-2">
          {['tag-a', 'tag-b', 'tag-c', 'tag-d'].map((id) => (
            <div
              key={id}
              className="h-8 w-32 bg-[var(--bg-secondary)] rounded-md animate-pulse"
            />
          ))}
        </div>
      </div>

      <div className="card-wh40k p-4 space-y-3">
        <div className="h-5 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
        <div className="space-y-2">
          {['line-a', 'line-b', 'line-c', 'line-d', 'line-e'].map((id) => (
            <div
              key={id}
              className="h-4 w-full bg-[var(--bg-secondary)] rounded animate-pulse"
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
        <span className="ml-2 text-sm text-[var(--text-secondary)]">
          Loading playbook...
        </span>
      </div>
    </div>
  )
}
