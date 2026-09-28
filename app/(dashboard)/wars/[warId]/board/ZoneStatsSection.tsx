'use client'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton
} from '@tacticus/ui-kit'
import { DataState } from '@/app/components/DataState'
import ZoneStatsGrid from '../../_components/ZoneStatsGrid'
import { useWarZones } from '../../_hooks'

const ZONE_SKELETON_KEYS = [
  'zone-1',
  'zone-2',
  'zone-3',
  'zone-4',
  'zone-5',
  'zone-6'
] as const

function GridSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {ZONE_SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className="rounded-lg border border-(--border) bg-(--bg-primary) p-5 space-y-4"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-32" />
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ZoneStatsSection({ warId }: { warId: string }) {
  const { data, isLoading, error } = useWarZones(warId)

  const zones = data ?? []

  return (
    <DataState
      error={error}
      isLoading={isLoading}
      errorUI={
        <Card className="border-(--border) bg-(--bg-primary)">
          <CardHeader className="pb-2">
            <CardTitle>Zone Stats Grid</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="text-center py-8 text-red-400">
              Failed to load zone data. Please try refreshing the page.
            </div>
          </CardContent>
        </Card>
      }
      skeleton={
        <Card className="border-(--border) bg-(--bg-primary)">
          <CardHeader className="pb-2">
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="pt-4">
            <GridSkeleton />
          </CardContent>
        </Card>
      }
    >
      <div className="space-y-4">
        <Card className="border-(--border) bg-(--bg-primary)">
          <CardHeader className="pb-2">
            <CardTitle>Zone Stats Grid</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {zones.length > 0 ? (
              <ZoneStatsGrid zones={zones} />
            ) : (
              <div className="text-center py-8 text-secondary-wh40k">
                No zone data available for this war
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DataState>
  )
}
