import { Loader2 } from 'lucide-react'

export default function BossPlaybooksLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-4 border-b border-[var(--card-border)] pb-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-[var(--bg-secondary)]" />
            <div className="h-8 w-40 animate-pulse rounded bg-[var(--bg-secondary)]" />
            <div className="h-4 w-56 animate-pulse rounded bg-[var(--bg-secondary)]" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-14 animate-pulse rounded-md bg-[var(--bg-secondary)]" />
            <div className="h-8 w-20 animate-pulse rounded-md bg-[var(--bg-secondary)]" />
            <div className="h-8 w-24 animate-pulse rounded-md bg-[var(--bg-secondary)]" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {['seasonal-card-a', 'seasonal-card-b'].map((id) => (
            <div
              key={id}
              className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)] p-3"
            >
              <div className="mb-3 h-5 w-36 animate-pulse rounded bg-[var(--bg-tertiary)]" />
              <div className="grid grid-cols-[104px_1fr] gap-2">
                <div className="h-[132px] animate-pulse rounded-md bg-[var(--bg-tertiary)]" />
                <div className="h-[132px] animate-pulse rounded-md bg-[var(--bg-tertiary)]" />
              </div>
              <div className="mt-3 h-20 animate-pulse rounded-md bg-[var(--bg-tertiary)]" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="h-10 bg-[var(--bg-secondary)] rounded-lg animate-pulse flex-1" />
        <div className="h-10 w-40 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
      </div>

      <div className="h-6 w-48 bg-[var(--bg-secondary)] rounded animate-pulse" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {['card-a', 'card-b', 'card-c', 'card-d', 'card-e', 'card-f'].map(
          (id) => (
            <div key={id} className="card-wh40k p-3 h-32">
              <div className="flex items-start gap-3">
                <div className="h-16 w-16 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="h-4 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="flex gap-2 mt-2">
                    <div className="h-5 w-12 bg-[var(--bg-secondary)] rounded animate-pulse" />
                    <div className="h-5 w-20 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
        <span className="ml-2 text-sm text-[var(--text-secondary)]">
          Loading playbooks...
        </span>
      </div>
    </div>
  )
}
