import { Badge, Card, CardContent } from '@tacticus/ui-kit'
import type { CoreComposition } from '../_types'
import { formatNumber, formatPercent, getRateTone, UnitRow } from './war-shared'

export default function CoreCard({ core }: { core: CoreComposition }) {
  const tone = getRateTone(core.winRate)
  return (
    <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <UnitRow units={core.coreUnits} size="sm" />
          <Badge className={`border ${tone}`}>
            {formatPercent(core.winRate)}
          </Badge>
        </div>
        <div className="text-sm text-[var(--text-secondary)]">
          Uses{' '}
          <span className="font-semibold text-[var(--text-primary)]">
            {formatNumber(core.totalUses)}
          </span>{' '}
          |{' '}
          {core.coreSize === 2 ? 'Pair synergy' : `Core size ${core.coreSize}`}
        </div>
        <div className="space-y-2 text-sm">
          <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase">
            Flex options
          </div>
          {core.flexOptions.map((flex) => (
            <div
              key={flex.unit.id}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <UnitRow units={[flex.unit]} size="sm" />
                <span>{flex.unit.name}</span>
              </div>
              <span className="font-mono text-[var(--text-secondary)]">
                {formatPercent(flex.frequency)} freq
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
