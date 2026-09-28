import { Badge, Card, CardContent } from '@tacticus/ui-kit'
import type { LineupStats } from '../_types'
import { formatNumber, formatPercent, getRateTone, UnitRow } from './war-shared'

export default function LineupCard({
  lineup,
  compact = false
}: {
  lineup: LineupStats
  compact?: boolean
}) {
  const winTone = getRateTone(lineup.winRate)

  return (
    <Card className="border-(--border) bg-(--bg-primary)">
      <CardContent className={compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}>
        <UnitRow units={lineup.units} size={compact ? 'sm' : 'md'} />
        <div className="flex items-center justify-between text-sm">
          <div className="text-secondary-wh40k">
            Uses{' '}
            <span className="font-semibold text-primary-wh40k">
              {formatNumber(lineup.uses)}
            </span>
          </div>
          <Badge className={`border ${winTone}`}>
            Win {formatPercent(lineup.winRate)}
          </Badge>
        </div>
        <div className="text-xs text-(--text-tertiary)">
          {formatNumber(lineup.wins)} wins, {formatNumber(lineup.losses)} losses
        </div>
      </CardContent>
    </Card>
  )
}
