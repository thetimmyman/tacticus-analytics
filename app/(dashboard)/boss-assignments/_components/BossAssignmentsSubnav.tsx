'use client'

import { usePathname } from 'next/navigation'
import {
  PageTabsSubnav,
  type PageTab
} from '@/app/components/navigation/PageTabsSubnav'

export interface BossAssignmentsSubnavProps {
  hasSeasonAccess?: boolean
}

/** Season Planner needs season-planner access. */
export function buildBossAssignmentsTabs(hasSeasonAccess: boolean): PageTab[] {
  const tabs: PageTab[] = [
    {
      value: 'assignments',
      label: 'Assignments',
      href: '/boss-assignments/current'
    },
    {
      value: 'performance',
      label: 'Performance',
      href: '/boss-assignments/performance'
    },
    { value: 'targets', label: 'Targets', href: '/boss-assignments/targets' }
  ]
  if (hasSeasonAccess) {
    tabs.push({
      value: 'season',
      label: 'Season Planner',
      href: '/boss-assignments/season'
    })
  }
  return tabs
}

/** A no-access viewer on `/season` falls back to 'assignments', never a missing tab. */
export function activeBossAssignmentsTab(
  pathname: string | null,
  availableValues?: string[]
): string {
  const candidate = (() => {
    if (!pathname) return 'assignments'
    if (pathname.startsWith('/boss-assignments/performance'))
      return 'performance'
    if (pathname.startsWith('/boss-assignments/targets')) return 'targets'
    if (pathname.startsWith('/boss-assignments/season')) return 'season'
    return 'assignments'
  })()
  if (availableValues && !availableValues.includes(candidate)) {
    return 'assignments'
  }
  return candidate
}

export function BossAssignmentsSubnav({
  hasSeasonAccess = false
}: BossAssignmentsSubnavProps) {
  const pathname = usePathname()
  const tabs = buildBossAssignmentsTabs(hasSeasonAccess)
  const active = activeBossAssignmentsTab(
    pathname,
    tabs.map((t) => t.value)
  )

  return (
    <PageTabsSubnav
      tabs={tabs}
      value={active}
      ariaLabel="Boss Assignments sections"
    />
  )
}
