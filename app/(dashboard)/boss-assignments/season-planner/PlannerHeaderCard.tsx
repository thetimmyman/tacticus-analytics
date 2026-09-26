'use client'

import Link from 'next/link'

export default function PlannerHeaderCard() {
  const seasonPlannerLink = (
    <Link
      href="/boss-assignments/current"
      className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      Back to Assignments
    </Link>
  )

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            Season Planner
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Generates a season-long attack schedule using token regen, inferred
            availability windows, and expected damage across main and prime
            bosses.
          </p>
        </div>
        {seasonPlannerLink}
      </div>
    </div>
  )
}
