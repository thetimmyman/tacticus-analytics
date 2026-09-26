import type { ReactNode } from 'react'
import { formatCompactNumber } from '../interactions/command-handlers/utils/formatting'

export const DISCORD_CHART_SIZE = { width: 800, height: 400 }

export type BidirectionalDatum = {
  label: string
  value: number // percentage, positive or negative
}

function getBarFillColor(value: number): string {
  if (value > 10) return '#22c55e' // green
  if (value >= 0) return '#eab308' // yellow
  return '#ef4444' // red
}

function getBarTextColor(value: number): string {
  if (value > 0) return '#86efac' // light green
  if (value === 0) return '#fde68a' // light yellow
  return '#fca5a5' // light red
}

export function BidirectionalBarChart({
  data,
  maxLabelWidth = 120
}: {
  data: BidirectionalDatum[]
  maxLabelWidth?: number
}) {
  const safeData = data.length > 0 ? data : [{ label: 'No data', value: 0 }]
  const sorted = [...safeData].sort((a, b) => b.value - a.value)
  const chartMax = Math.max(10, ...sorted.map((d) => Math.abs(d.value)))

  const headerHeight = 28
  const rowHeight = 22
  const footerHeight = 36

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: headerHeight,
          borderBottom: '1px solid rgba(198,168,83,0.5)',
          marginBottom: 4
        }}
      >
        <div
          style={{
            width: maxLabelWidth,
            fontSize: 11,
            color: '#c6a853',
            fontWeight: 600
          }}
        >
          Player
        </div>
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 11,
            color: '#c6a853',
            fontWeight: 600
          }}
        >
          Performance Chart
        </div>
        <div
          style={{
            width: 50,
            textAlign: 'right',
            fontSize: 11,
            color: '#c6a853',
            fontWeight: 600
          }}
        >
          %
        </div>
      </div>

      {/* Rows */}
      {sorted.map((item) => {
        const barWidth = (Math.abs(item.value) / chartMax) * 50
        const isPositive = item.value >= 0
        const sign = item.value > 0 ? '+' : ''

        return (
          <div
            key={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: rowHeight
            }}
          >
            <div
              style={{
                width: maxLabelWidth,
                fontSize: 12,
                color: 'rgba(248,250,252,0.85)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {truncateLabel(item.label, Math.floor(maxLabelWidth / 7))}
            </div>

            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
                height: 14
              }}
            >
              {/* Center line */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: 1,
                  backgroundColor: 'rgba(148,163,184,0.3)'
                }}
              />

              {isPositive ? (
                <div style={{ display: 'flex', width: '100%' }}>
                  <div style={{ width: '50%' }} />
                  <div style={{ width: '50%', display: 'flex' }}>
                    <div
                      style={{
                        height: 10,
                        width: `${barWidth}%`,
                        backgroundColor: getBarFillColor(item.value),
                        borderRadius: 2
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', width: '100%' }}>
                  <div
                    style={{
                      width: '50%',
                      display: 'flex',
                      justifyContent: 'flex-end'
                    }}
                  >
                    <div
                      style={{
                        height: 10,
                        width: `${barWidth}%`,
                        backgroundColor: getBarFillColor(item.value),
                        borderRadius: 2
                      }}
                    />
                  </div>
                  <div style={{ width: '50%' }} />
                </div>
              )}
            </div>

            <div
              style={{
                width: 50,
                textAlign: 'right',
                fontSize: 12,
                color: getBarTextColor(item.value),
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {`${sign}${Math.round(item.value)}%`}
            </div>
          </div>
        )
      })}

      {/* Footer axis labels */}
      <div
        style={{
          display: 'flex',
          height: footerHeight,
          paddingTop: 8,
          borderTop: '1px solid rgba(148,163,184,0.2)',
          marginTop: 4
        }}
      >
        <div style={{ width: maxLabelWidth }} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'rgba(148,163,184,0.6)'
          }}
        >
          <span>{`-${Math.round(chartMax)}%`}</span>
          <span>0%</span>
          <span>{`+${Math.round(chartMax)}%`}</span>
        </div>
        <div style={{ width: 50 }} />
      </div>
    </div>
  )
}

export type RadarDatum = {
  label: string
  vsGuild: number // raw percentage diff (e.g. +15 or -20)
  vsCluster: number // raw percentage diff
}

function polarToXY(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number
): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad)
  }
}

function buildPolygonPoints(
  cx: number,
  cy: number,
  values: number[],
  maxVal: number,
  maxRadius: number,
  count: number
): string {
  return values
    .map((val, i) => {
      const angle = (360 / count) * i
      const r = (val / maxVal) * maxRadius
      const { x, y } = polarToXY(cx, cy, r, angle)
      return `${x},${y}`
    })
    .join(' ')
}

export function RadarChartSVG({
  data,
  playerName,
  hasCluster = true
}: {
  data: RadarDatum[]
  playerName: string
  hasCluster?: boolean
}) {
  if (data.length === 0) return null

  const svgWidth = 740
  const svgHeight = 560
  const cx = svgWidth / 2
  const cy = 260
  const maxRadius = 190
  const count = data.length

  // Percentage diffs mapped onto 0-100, centred on 50.
  const maxAbs = Math.max(
    25,
    ...data.map((d) => Math.max(Math.abs(d.vsGuild), Math.abs(d.vsCluster)))
  )
  const scale = 50 / maxAbs

  const guildValues = data.map((d) =>
    Math.min(100, Math.max(0, 50 + d.vsGuild * scale))
  )
  const clusterValues = data.map((d) =>
    Math.min(100, Math.max(0, 50 + d.vsCluster * scale))
  )
  const baselineValues = data.map(() => 50)

  const rings = [20, 40, 60, 80, 100]
  const ringLabels = [
    `-${Math.round(maxAbs)}%`,
    `-${Math.round(maxAbs / 2)}%`,
    'Avg',
    `+${Math.round(maxAbs / 2)}%`,
    `+${Math.round(maxAbs)}%`
  ]

  const gridPolygons = rings.map((ringVal) => {
    const pts = Array.from({ length: count }, (_, i) => {
      const angle = (360 / count) * i
      const r = (ringVal / 100) * maxRadius
      const { x, y } = polarToXY(cx, cy, r, angle)
      return `${x},${y}`
    }).join(' ')
    return { ringVal, pts }
  })

  const guildPoly = buildPolygonPoints(
    cx,
    cy,
    guildValues,
    100,
    maxRadius,
    count
  )
  const clusterPoly = buildPolygonPoints(
    cx,
    cy,
    clusterValues,
    100,
    maxRadius,
    count
  )
  const baselinePoly = buildPolygonPoints(
    cx,
    cy,
    baselineValues,
    100,
    maxRadius,
    count
  )

  const axisLines = Array.from({ length: count }, (_, i) => {
    const angle = (360 / count) * i
    const { x, y } = polarToXY(cx, cy, maxRadius, angle)
    return { x1: cx, y1: cy, x2: x, y2: y }
  })

  const axisLabels = data.map((d, i) => {
    const angle = (360 / count) * i
    const { x, y } = polarToXY(cx, cy, maxRadius + 24, angle)
    return { x, y, label: d.label }
  })

  const ringLabelPositions = rings.map((ringVal, i) => {
    const r = (ringVal / 100) * maxRadius
    const { x, y } = polarToXY(cx, cy, r, 0)
    return { x: x + 4, y, label: ringLabels[i] }
  })

  const axisLabelStyles = axisLabels.map((lbl, i) => {
    const angle = (360 / count) * i
    let translateX = '0%'
    if (angle > 90 && angle < 270) translateX = '-100%'
    else if (angle === 90 || angle === 270) translateX = '-50%'
    return { ...lbl, translateX }
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        alignItems: 'center'
      }}
    >
      <div
        style={{
          fontSize: 14,
          color: 'rgba(148,163,184,0.8)',
          marginBottom: 8
        }}
      >
        {`Comparing ${playerName} against guild${hasCluster ? ' and cluster' : ''} averages across all assigned targets.`}
      </div>

      {/* SVG + overlay labels container */}
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: svgWidth,
          height: svgHeight
        }}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        >
          {/* Grid polygons */}
          {gridPolygons.map((item) => (
            <polygon
              key={`grid-${item.ringVal}`}
              points={item.pts}
              fill="none"
              stroke="rgba(148,163,184,0.25)"
              strokeWidth={1}
            />
          ))}

          {/* Axis lines */}
          {axisLines.map((line) => (
            <line
              key={`axis-${line.x2}-${line.y2}`}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="rgba(148,163,184,0.2)"
              strokeWidth={1}
            />
          ))}

          {/* Baseline polygon (orange dashed) */}
          <polygon
            points={baselinePoly}
            fill="#f97316"
            fillOpacity={0.08}
            stroke="#f97316"
            strokeWidth={2}
            strokeDasharray="6 4"
          />

          {/* Cluster polygon (blue) */}
          {hasCluster && (
            <polygon
              points={clusterPoly}
              fill="#3b82f6"
              fillOpacity={0.2}
              stroke="#3b82f6"
              strokeWidth={2}
            />
          )}

          {/* Guild polygon (green) */}
          <polygon
            points={guildPoly}
            fill="#10b981"
            fillOpacity={0.2}
            stroke="#10b981"
            strokeWidth={2}
          />
        </svg>

        {/* Labels are absolute divs overlaying the SVG. */}
        {ringLabelPositions.map((pos) => {
          const lbl = pos.label ?? ''
          const color =
            lbl === 'Avg'
              ? '#facc15'
              : lbl.startsWith('+')
                ? '#22c55e'
                : '#f87171'
          return (
            <div
              key={`rlabel-${lbl}`}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                transform: 'translateY(-50%)',
                fontSize: 10,
                color
              }}
            >
              {lbl}
            </div>
          )
        })}

        {/* Axis labels, absolutely positioned over the SVG */}
        {axisLabelStyles.map((lbl) => (
          <div
            key={`alabel-${lbl.label}`}
            style={{
              position: 'absolute',
              left: lbl.x,
              top: lbl.y,
              transform: `translate(${lbl.translateX}, -50%)`,
              fontSize: 11,
              color: '#cbd5e1',
              whiteSpace: 'nowrap'
            }}
          >
            {lbl.label}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 14,
              height: 14,
              backgroundColor: '#f97316',
              borderRadius: 2
            }}
          />
          <span style={{ color: '#f97316' }}>Baseline (Avg)</span>
        </div>
        {hasCluster && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 14,
                height: 14,
                backgroundColor: '#3b82f6',
                borderRadius: 2
              }}
            />
            <span style={{ color: '#3b82f6' }}>vs Cluster Avg</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 14,
              height: 14,
              backgroundColor: '#10b981',
              borderRadius: 2
            }}
          />
          <span style={{ color: '#10b981' }}>vs Guild Avg</span>
        </div>
      </div>
    </div>
  )
}

export type ChartDatum = {
  label: string
  value: number
  displayValue?: string
}

export function truncateLabel(label: string, maxLength = 20) {
  if (label.length <= maxLength) return label
  return `${label.slice(0, Math.max(0, maxLength - 3))}...`
}

export function ChartFrame({
  title,
  subtitle,
  accentColor,
  children
}: {
  title: string
  subtitle?: string
  accentColor: string
  children: ReactNode
}) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: 28,
        gap: 18,
        backgroundColor: '#0b0f1a',
        color: '#f8fafc',
        fontFamily: 'Space Grotesk, Arial, sans-serif',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: [
            'linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px)',
            'linear-gradient(180deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px)',
            `radial-gradient(circle at 20% 20%, ${accentColor}25 0%, transparent 55%)`
          ].join(','),
          backgroundSize: '48px 48px, 48px 48px, 480px 480px',
          opacity: 0.55
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700 }}>{title}</div>
        {subtitle ? (
          <div style={{ fontSize: 14, color: 'rgba(248,250,252,0.7)' }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
        {children}
      </div>
    </div>
  )
}

export function BarChart({
  data,
  accentColor,
  maxLabelWidth = 180
}: {
  data: ChartDatum[]
  accentColor: string
  maxLabelWidth?: number
}) {
  const safeData = data.length > 0 ? data : [{ label: 'No data', value: 0 }]
  const maxValue = Math.max(1, ...safeData.map((item) => item.value))

  // Occurrence counts keep keys unique for duplicate labels.
  const labelCounts = new Map<string, number>()
  const dataWithKeys = safeData.map((item) => {
    const count = labelCounts.get(item.label) ?? 0
    labelCounts.set(item.label, count + 1)
    return {
      ...item,
      uniqueKey: count > 0 ? `${item.label}-occurrence-${count}` : item.label
    }
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '100%'
      }}
    >
      {dataWithKeys.map((item) => {
        const widthPercent = Math.max(
          6,
          Math.round((item.value / maxValue) * 100)
        )
        return (
          <div
            key={item.uniqueKey}
            style={{ display: 'flex', gap: 12, alignItems: 'center' }}
          >
            <div
              style={{
                width: maxLabelWidth,
                fontSize: 14,
                color: 'rgba(248,250,252,0.8)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {truncateLabel(item.label, Math.floor(maxLabelWidth / 8))}
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                height: 12,
                backgroundColor: 'rgba(148,163,184,0.2)',
                borderRadius: 999,
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${widthPercent}%`,
                  backgroundColor: accentColor,
                  borderRadius: 999
                }}
              />
            </div>
            <div
              style={{
                width: 80,
                textAlign: 'right',
                fontSize: 14,
                color: 'rgba(248,250,252,0.9)',
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {item.displayValue ??
                formatCompactNumber(item.value, { decimals: 1 })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
