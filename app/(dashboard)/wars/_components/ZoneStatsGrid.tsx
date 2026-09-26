import { Badge } from '@tacticus/ui-kit'
import type { ZoneCell } from '../_types'
import { formatNumber, getRateTone } from './war-shared'
import ZoneImageTooltip from './ZoneImageTooltip'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

interface MetricPanelProps {
  title: string
  rows: { label: string; value: string; tone?: string }[]
}

function MetricPanel({ title, rows }: MetricPanelProps) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 space-y-1">
      <div className="font-semibold text-[var(--text-secondary)] uppercase">
        {title}
      </div>
      {rows.map(({ label, value, tone }) => (
        <div key={label} className="flex items-center justify-between">
          <span>{label}</span>
          <span
            className={
              tone
                ? `font-semibold ${tone}`
                : 'font-mono text-[var(--text-secondary)]'
            }
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ZoneStatsGrid({ zones }: { zones: ZoneCell[] }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {zones.map((zone) => {
        const offenseTone = getRateTone(zone.offense.winRate)
        const defenseTone = getRateTone(zone.defense.holdRate, 50, 30)
        return (
          <div
            key={zone.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-5 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between">
              {/* The zones API ships only a raw zone_type; it becomes a display string here, once. */}
              <ZoneImageTooltip zoneType={zone.zoneType} side="right">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {zoneDisplayName(zone.zoneType)}
                </div>
              </ZoneImageTooltip>
              {/* Other statuses have no actionable badge in this read-only view. */}
              {zone.status === 'destroyed' && (
                <Badge className="bg-red-500/10 text-red-300 border-red-500/30">
                  destroyed
                </Badge>
              )}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Assigned: {zone.assignedPlayer || 'Unassigned'}
            </div>
            <div className="grid gap-2">
              <MetricPanel
                title="Offense"
                rows={[
                  {
                    label: 'Attacks',
                    value: formatNumber(zone.offense.attacks)
                  },
                  {
                    label: 'Win rate',
                    value: `${zone.offense.winRate}%`,
                    tone: offenseTone
                  },
                  {
                    label: 'Avg score',
                    value: formatNumber(zone.offense.avgScore)
                  }
                ]}
              />
              <MetricPanel
                title="Defense"
                rows={[
                  {
                    label: 'Defends',
                    value: formatNumber(zone.defense.defends)
                  },
                  {
                    label: 'Hold rate',
                    value: `${zone.defense.holdRate}%`,
                    tone: defenseTone
                  },
                  {
                    label: 'Avg conceded',
                    value: formatNumber(zone.defense.avgConceded)
                  }
                ]}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
