'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import PerformanceTable from '../../_components/PerformanceTable'
import WarPageHeader from '../../_components/WarPageHeader'
import { useHeroPerformance } from '../../_hooks/useHeroPerformance'

export default function DefenderPerformancePage() {
  const { data: heroes = [], isLoading, error } = useHeroPerformance('defense')

  return (
    <div className="px-4 py-6 space-y-6">
      <WarPageHeader
        title="Defense Heroes"
        description="Per-unit defense hero hold rates and survival stats."
      />
      <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
        <CardHeader className="pb-2">
          <CardTitle>Top Defense Heroes</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-12 text-[var(--text-secondary)]">
              Loading hero performance...
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">
              Failed to load hero performance
            </div>
          ) : (
            <PerformanceTable rows={heroes} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
