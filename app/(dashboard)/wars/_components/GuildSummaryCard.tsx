import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import type { GuildSummary } from '../_types'
import { formatNumber } from './war-shared'

export default function GuildSummaryCard({
  summary
}: {
  summary: GuildSummary
}) {
  return (
    <Card className="border-(--border) bg-(--bg-primary)">
      <CardHeader className="pb-2">
        <CardTitle>{summary.guildName}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-5">
        <div className="text-sm text-secondary-wh40k">
          <span title="Official war scoring: includes zone-capture bonuses (up to ~40K per capture, credited to the player who lands the capture). Summed from recorded battles.">
            Official score {formatNumber(summary.totalScore)}
          </span>{' '}
          | Attacks {formatNumber(summary.totalAttacks)} | Defends{' '}
          {formatNumber(summary.totalDefenses)}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1">
            <div className="text-xs text-(--text-tertiary)">Perfect</div>
            <div className="text-lg font-semibold text-primary-wh40k">
              {formatNumber(summary.perfectHits)}
            </div>
          </div>
          <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1">
            <div className="text-xs text-(--text-tertiary)">Attacks</div>
            <div className="text-lg font-semibold text-primary-wh40k">
              {formatNumber(summary.totalAttacks)}
            </div>
          </div>
          <div
            className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1"
            title="Official war scoring: includes zone-capture bonuses (up to ~40K per capture, credited to the player who lands the capture)."
          >
            <div className="text-xs text-(--text-tertiary)">
              Official Points
            </div>
            <div className="text-lg font-semibold text-primary-wh40k">
              {formatNumber(summary.totalScore)}
            </div>
          </div>
          <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1">
            <div className="text-xs text-(--text-tertiary)">Defended</div>
            <div className="text-lg font-semibold text-primary-wh40k">
              {formatNumber(summary.totalDefenses)}
            </div>
          </div>
          <div className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1">
            <div className="text-xs text-(--text-tertiary)">Conceded</div>
            <div className="text-lg font-semibold text-primary-wh40k">
              {formatNumber(summary.totalConceded)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-secondary-wh40k">
          <span>Win rate {summary.winRate}%</span>
          <span>Hold rate {summary.holdRate}%</span>
          <span>Guild tag {summary.guildTag}</span>
        </div>
      </CardContent>
    </Card>
  )
}
