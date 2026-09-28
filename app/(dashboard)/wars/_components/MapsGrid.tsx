import { Badge, Card, CardContent } from '@tacticus/ui-kit'
import type { MapStats } from '../_types'
import { formatNumber, getRateTone } from './war-shared'
import ZoneImageTooltip from './ZoneImageTooltip'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

export default function MapsGrid({ maps }: { maps: MapStats[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {maps.map((map) => {
        const offenseTone = getRateTone(map.offense.winRate)
        const defenseTone = getRateTone(map.defense.holdRate, 50, 30)
        return (
          <Card
            key={map.zoneType}
            className="border-(--border) bg-(--bg-primary)"
          >
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <ZoneImageTooltip zoneType={map.zoneType} side="right">
                  <div className="text-sm font-semibold text-primary-wh40k">
                    {zoneDisplayName(map.zoneType)}
                  </div>
                </ZoneImageTooltip>
                <Badge className="bg-(--bg-secondary) text-secondary-wh40k border-(--border)">
                  Map
                </Badge>
              </div>
              <div className="rounded-md border border-(--border) bg-(--bg-secondary) p-4 space-y-2 text-sm">
                <div className="text-xs font-semibold text-secondary-wh40k uppercase">
                  Offense
                </div>
                <div className="flex items-center justify-between">
                  <span>Attacks</span>
                  <span className="font-mono text-primary-wh40k">
                    {formatNumber(map.offense.attacks)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Win rate</span>
                  <span className={`font-semibold ${offenseTone}`}>
                    {map.offense.winRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Avg score</span>
                  <span className="font-mono text-secondary-wh40k">
                    {formatNumber(map.offense.avgScore)}
                  </span>
                </div>
              </div>
              <div className="rounded-md border border-(--border) bg-(--bg-secondary) p-4 space-y-2 text-sm">
                <div className="text-xs font-semibold text-secondary-wh40k uppercase">
                  Defense
                </div>
                <div className="flex items-center justify-between">
                  <span>Defends</span>
                  <span className="font-mono text-primary-wh40k">
                    {formatNumber(map.defense.defends)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Hold rate</span>
                  <span className={`font-semibold ${defenseTone}`}>
                    {map.defense.holdRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Avg conceded</span>
                  <span className="font-mono text-secondary-wh40k">
                    {formatNumber(map.defense.avgScoreConceded)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
