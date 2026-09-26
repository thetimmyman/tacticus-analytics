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

const colorClasses = {
  blue: 'from-[var(--primary)] to-[var(--accent)]',
  green: 'from-green-500 to-green-400', // Keep for success states
  red: 'from-red-500 to-red-400', // Keep for error states
  purple: 'from-[var(--accent)] to-[var(--primary)]',
  yellow: 'from-yellow-500 to-yellow-400', // Keep for warning states
  cyan: 'from-[var(--primary)] to-[var(--accent)]',
  pink: 'from-[var(--accent)] to-[var(--primary)]'
} as const

const vsClusterColorClass = (percent: number) => {
  if (percent > 0) return 'text-green-400 bg-green-400/20' // Keep for positive
  if (percent < 0) return 'text-red-400 bg-red-400/20' // Keep for negative
  return 'text-[var(--text-secondary)] bg-[var(--card-border)]'
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
  const formattedAvg = formatDamage(avgValue)
  const formattedMax = formatDamage(maxValue)

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {label}
          </span>
          {sublabel && (
            <span className="text-xs text-[var(--text-secondary)]">
              {sublabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--accent)]">
            AVG: {formattedAvg}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            MAX: {formattedMax}
          </span>
          {vsClusterPercent !== undefined && (
            <span
              className={`text-xs px-1 rounded ${vsClusterColorClass(vsClusterPercent)}`}
            >
              vsCluster {vsClusterPercent > 0 ? '+' : ''}
              {Math.round(vsClusterPercent)}%
            </span>
          )}
        </div>
      </div>
      <div className="w-full bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-full h-6 overflow-hidden relative">
        <div
          className={`h-full bg-gradient-to-r ${colorClasses[color]} transition-all ${
            animate ? 'duration-1000 ease-out' : ''
          }`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        >
          {showPercentage && percentage > 5 && (
            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-[var(--text-primary)]">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
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
        <span className="text-sm font-medium text-[var(--text-secondary)]">
          {label}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">
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
                          ? 'text-[var(--primary)]'
                          : seg.color === 'purple'
                            ? 'text-[var(--accent)]'
                            : seg.color === 'pink'
                              ? 'text-[var(--accent)]'
                              : seg.color === 'cyan'
                                ? 'text-[var(--primary)]'
                                : 'text-[var(--text-secondary)]'
                }
              >
                {seg.label}: {seg.value}
              </span>
              {idx < segments.length - 1 && (
                <span className="mx-1 text-[var(--text-secondary)]">•</span>
              )}
            </span>
          ))}
          <span className="mx-1 text-[var(--text-secondary)]">•</span>
          <span className="text-[var(--primary)]">
            Total: {segments.reduce((sum, seg) => sum + seg.value, 0)}
          </span>
        </span>
      </div>
      <div className="w-full bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-full h-8 overflow-hidden relative">
        {segments.map((segment, idx) => {
          const percentage = total > 0 ? (segment.value / total) * 100 : 0
          const leftPosition = cumulativePercent
          cumulativePercent += percentage

          return (
            <div
              key={idx}
              className={`h-full bg-gradient-to-r ${colorClasses[segment.color]} transition-all ${
                animate ? 'duration-500' : ''
              } absolute flex items-center justify-center`}
              style={{
                width: `${percentage}%`,
                left: `${leftPosition}%`
              }}
              title={`${segment.label}: ${segment.value}`}
            >
              {showLabels && percentage > 10 && (
                <span className="text-xs font-semibold text-[var(--text-primary)]">
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
