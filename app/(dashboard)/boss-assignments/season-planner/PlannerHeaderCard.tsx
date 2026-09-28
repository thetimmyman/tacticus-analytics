'use client'

import Link from 'next/link'

export default function PlannerHeaderCard() {
  const seasonPlannerLink = (
    <Link
      href="/boss-assignments/current"
      className="text-sm text-secondary-wh40k hover:text-primary-wh40k"
    >
      Back to Assignments
    </Link>
  )

  return (
    <div className="rounded-lg border border-(--card-border) bg-(--card-bg) p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-primary-wh40k">
            Season Planner
          </h2>
          <p className="mt-2 text-sm text-secondary-wh40k">
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
