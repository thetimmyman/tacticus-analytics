interface BossAssignmentsHeaderProps {
  pageTitle: string
  pageSubtitle: string
}

// `<h2>`: the layout owns the page's `<h1>`.
export function BossAssignmentsHeader({
  pageTitle,
  pageSubtitle
}: BossAssignmentsHeaderProps) {
  return (
    <div className="bg-card/50 hover:bg-card/80 transition-colors duration-200 rounded-lg p-3 sm:p-4 md:p-6 border border-[color-mix(in_srgb,var(--primary)_20%,transparent)]">
      <div className="hidden md:block">
        <div className="flex items-center gap-4 mb-2">
          <h2 className="text-xl sm:text-2xl font-bold text-[var(--primary)]">
            {pageTitle}
          </h2>
        </div>
        <p className="text-amber-100/70">{pageSubtitle}</p>
      </div>

      <div className="md:hidden space-y-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[var(--primary)] mb-2">
            {pageTitle}
          </h2>
          <p className="text-amber-100/70 text-sm">{pageSubtitle}</p>
        </div>
      </div>
    </div>
  )
}
