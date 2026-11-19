'use client'

import { formatDamage } from '@tacticus/app-core/formatters'

interface ProgressBarProps {
  label: string
  sublabel?: string
  avgValue: number
  maxValue: number
  unit?: string
  vsClusterPercent?: number
  color?: 'blue' | 'green' | 'red' | 'purple' | 'yellow' | 'cyan'
  showPercentage?: boolean
  animate?: boolean
}

// Fill and the label that reads on it, chosen together. Theme-colour bars use
// the shared call-to-action stops, so one label reads along the whole
// gradient on every theme; the status colours keep their hue with a black
// label (at least 5.6:1). The percentage is written twice, once inside the
// fill and once over the empty track, so each copy keeps its own surface.
const THEME_FILL = 'bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to)'
const THEME_FILL_REVERSED =
  'bg-linear-to-r/srgb from-(--cta-to) to-(--cta-from)'
const THEME_LABEL = 'text-on-cta-wh40k'

export const BAR_PAINT = {
  blue: { fill: THEME_FILL, label: THEME_LABEL },
  green: {
    fill: 'bg-linear-to-r from-green-500 to-green-400',
    label: 'text-black'
  },
  red: { fill: 'bg-linear-to-r from-red-500 to-red-400', label: 'text-black' },
  purple: { fill: THEME_FILL_REVERSED, label: THEME_LABEL },
  yellow: {
    fill: 'bg-linear-to-r from-yellow-500 to-yellow-400',
    label: 'text-black'
  },
  cyan: { fill: THEME_FILL, label: THEME_LABEL },
  pink: { fill: THEME_FILL_REVERSED, label: THEME_LABEL }
} as const

// What a bar paints when nothing is written on it: the plain theme gradient,
// which the legend text beside a stacked bar is coloured to match.
const PLAIN_FILL = {
  blue: 'bg-linear-to-r from-(--primary) to-(--accent)',
  green: BAR_PAINT.green.fill,
  red: BAR_PAINT.red.fill,
  purple: 'bg-linear-to-r from-(--accent) to-(--primary)',
  yellow: BAR_PAINT.yellow.fill,
  cyan: 'bg-linear-to-r from-(--primary) to-(--accent)',
  pink: 'bg-linear-to-r from-(--accent) to-(--primary)'
} as const

const LABEL_CLASS =
  'pointer-events-none absolute inset-y-0 flex items-center justify-center text-xs font-semibold'

const vsClusterColorClass = (percent: number) => {
  if (percent > 0) return 'text-green-400 bg-green-400/20' // Keep for positive
  if (percent < 0) return 'text-red-400 bg-red-400/20' // Keep for negative
  return 'text-secondary-wh40k bg-(--card-border)'
}

export function ProgressBar({
  label,
  sublabel,
  avgValue,
  maxValue,
  vsClusterPercent,
  color = 'blue',
  showPercentage = true,
  animate = true
}: ProgressBarProps) {
  const percentage = maxValue > 0 ? (avgValue / maxValue) * 100 : 0
  const filled = Math.min(percentage, 100)
  const paint = BAR_PAINT[color]
  const text = `${Math.round(percentage)}%`
  const showLabel = showPercentage && percentage > 5
  const formattedAvg = formatDamage(avgValue)
  const formattedMax = formatDamage(maxValue)

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-primary-wh40k">
            {label}
          </span>
          {sublabel && (
            <span className="text-xs text-secondary-wh40k">{sublabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--accent)">
            {`AVG: ${formattedAvg}`}
          </span>
          <span className="text-xs text-secondary-wh40k">
            {`MAX: ${formattedMax}`}
          </span>
          {vsClusterPercent !== undefined && (
            <span
              className={`text-xs px-1 rounded-sm ${vsClusterColorClass(vsClusterPercent)}`}
            >
              {`vsCluster ${vsClusterPercent > 0 ? '+' : ''}${Math.round(vsClusterPercent)}%`}
            </span>
          )}
        </div>
      </div>
      <div
        data-bar
        className="w-full bg-(--card-bg) transition-colors duration-200 rounded-full h-6 overflow-hidden relative"
      >
        <div
          className={`relative h-full overflow-hidden ${paint.fill} transition-all ${
            animate ? 'duration-1000 ease-out' : ''
          }`}
          style={{ width: `${filled}%` }}
        >
          {showLabel && (
            <span
              className={`${LABEL_CLASS} start-0 ${paint.label}`}
              style={{ width: `${10000 / filled}%` }}
              data-label="fill"
            >
              {text}
            </span>
          )}
        </div>
        {showLabel && filled < 100 && (
          <div
            className="pointer-events-none absolute inset-y-0 select-none overflow-hidden"
            style={{ insetInlineStart: `${filled}%`, insetInlineEnd: 0 }}
            aria-hidden="true"
          >
            <span
              className={`${LABEL_CLASS} end-0 text-primary-wh40k`}
              style={{ width: `${10000 / (100 - filled)}%` }}
              data-label="track"
            >
              {text}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

interface StackedProgressBarProps {
  label: string
  segments: Array<{
    label: string
    value: number
    color: 'blue' | 'pink' | 'green' | 'yellow' | 'purple' | 'cyan' | 'red'
  }>
  total: number
  showLabels?: boolean
  animate?: boolean
}

export function StackedProgressBar({
  label,
  segments,
  total,
  showLabels = true,
  animate = true
}: StackedProgressBarProps) {
  let cumulativePercent = 0

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium text-secondary-wh40k">
          {label}
        </span>
        <span className="text-xs text-secondary-wh40k">
          {segments.map((seg, idx) => (
            <span key={idx}>
              <span
                className={
                  seg.color === 'green'
                    ? 'text-green-400' // Keep for success
                    : seg.color === 'yellow'
                      ? 'text-yellow-400' // Keep for warning
                      : seg.color === 'red'
                        ? 'text-red-400' // Keep for error
                        : seg.color === 'blue'
                          ? 'text-(--primary)'
                          : seg.color === 'purple'
                            ? 'text-(--accent)'
                            : seg.color === 'pink'
                              ? 'text-(--accent)'
                              : seg.color === 'cyan'
                                ? 'text-(--primary)'
                                : 'text-secondary-wh40k'
                }
              >
                {`${seg.label}: ${seg.value}`}
              </span>
              {idx < segments.length - 1 && (
                <span className="mx-1 text-secondary-wh40k">•</span>
              )}
            </span>
          ))}
          <span className="mx-1 text-secondary-wh40k">•</span>
          <span className="text-(--primary)">
            {`Total: ${segments.reduce((sum, seg) => sum + seg.value, 0)}`}
          </span>
        </span>
      </div>
      <div className="w-full bg-(--card-bg) transition-colors duration-200 rounded-full h-8 overflow-hidden relative">
        {segments.map((segment, idx) => {
          const percentage = total > 0 ? (segment.value / total) * 100 : 0
          const leftPosition = cumulativePercent
          cumulativePercent += percentage

          return (
            <div
              key={idx}
              className={`h-full ${showLabels ? BAR_PAINT[segment.color].fill : PLAIN_FILL[segment.color]} transition-all ${
                animate ? 'duration-500' : ''
              } absolute flex items-center justify-center overflow-hidden`}
              style={{
                width: `${percentage}%`,
                left: `${leftPosition}%`
              }}
              title={`${segment.label}: ${segment.value}`}
            >
              {showLabels && percentage > 10 && (
                <span
                  className={`truncate px-1 text-xs font-semibold ${BAR_PAINT[segment.color].label}`}
                >
                  {segment.label}: {segment.value}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
