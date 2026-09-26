'use client'

import { useRef, useState, useEffect } from 'react'
import { formatDamage, formatNumber } from '@tacticus/app-core/formatters'
import type { BoxWhiskerStats } from '@/app/components/boss-performance/boxWhiskerUtils'

interface BoxWhiskerPlotProps {
  stats: BoxWhiskerStats
  color?: string
  minHeight?: number
}

export function BoxWhiskerPlot({
  stats,
  color = 'var(--accent)',
  minHeight = 120
}: BoxWhiskerPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({
    width: 300,
    height: minHeight
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect()
      const width = rect.width || 300
      const height = Math.max(minHeight, Math.min(width * 0.5, 200))
      setDimensions({ width, height })
    }

    updateDimensions()

    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [minHeight])

  const { min, q1, median, q3, max, sampleSize } = stats
  const values = [min, q1, median, q3, max].filter((value) =>
    Number.isFinite(value)
  )

  if (values.length === 0) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">
        Not enough data to render a distribution.
      </div>
    )
  }

  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = maxValue - minValue
  const padding = range === 0 ? Math.max(maxValue * 0.1, 1) : range * 0.1
  const domainMin = minValue - padding
  const domainMax = maxValue + padding

  const svgWidth = dimensions.width
  const svgHeight = dimensions.height
  const paddingLeft = 10
  const paddingRight = 10
  const plotWidth = svgWidth - paddingLeft - paddingRight

  const scale = (value: number) => {
    if (domainMax === domainMin) {
      return paddingLeft + plotWidth / 2
    }
    const normalized = (value - domainMin) / (domainMax - domainMin)
    const clamped = Math.min(1, Math.max(0, normalized))
    return paddingLeft + clamped * plotWidth
  }

  const axisY = svgHeight * 0.75
  const boxCenterY = svgHeight * 0.4
  const boxHeight = Math.min(30, svgHeight * 0.25)
  const whiskerLineY1 = boxCenterY - boxHeight / 2
  const whiskerLineY2 = boxCenterY + boxHeight / 2

  const minX = scale(min)
  const q1X = scale(q1)
  const medianX = scale(median)
  const q3X = scale(q3)
  const maxX = scale(max)

  const boxWidth = Math.max(q3X - q1X, 2)

  const labelFontSize = Math.max(10, Math.min(12, svgWidth / 30))
  const valueFontSize = labelFontSize * 0.9
  const estimatedCharWidth = valueFontSize * 0.6

  const rawTicks = [
    { label: 'Min', value: min, x: minX, align: 'start' as const, priority: 1 },
    {
      label: 'Median',
      value: median,
      x: medianX,
      align: 'middle' as const,
      priority: 0
    },
    { label: 'Max', value: max, x: maxX, align: 'end' as const, priority: 1 }
  ]

  const getTickBounds = (tick: (typeof rawTicks)[0]) => {
    const labelWidth = formatDamage(tick.value).length * estimatedCharWidth
    if (tick.align === 'start') {
      return { left: tick.x, right: tick.x + labelWidth }
    } else if (tick.align === 'end') {
      return { left: tick.x - labelWidth, right: tick.x }
    } else {
      return { left: tick.x - labelWidth / 2, right: tick.x + labelWidth / 2 }
    }
  }

  const ticksSortedByPriority = [...rawTicks].sort(
    (a, b) => a.priority - b.priority
  )
  const acceptedTicks: typeof rawTicks = []

  for (const tick of ticksSortedByPriority) {
    const bounds = getTickBounds(tick)
    const hasCollision = acceptedTicks.some((accepted) => {
      const acceptedBounds = getTickBounds(accepted)
      const gap = 8
      return !(
        bounds.right + gap < acceptedBounds.left ||
        bounds.left - gap > acceptedBounds.right
      )
    })
    if (!hasCollision) {
      acceptedTicks.push(tick)
    }
  }

  const axisTicks = rawTicks.filter((t) => acceptedTicks.includes(t))

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs text-[var(--text-secondary)]">
        <span>Damage distribution</span>
        <span>{formatNumber(sampleSize)} hits</span>
      </div>
      <div ref={containerRef} className="relative w-full" style={{ minHeight }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          className="w-full"
          style={{ display: 'block' }}
          shapeRendering="geometricPrecision"
        >
          {/* Axis */}
          <line
            x1={paddingLeft}
            x2={svgWidth - paddingRight}
            y1={axisY}
            y2={axisY}
            stroke="var(--card-border)"
            strokeWidth={1}
          />

          {/* Whisker */}
          <line
            x1={minX}
            x2={maxX}
            y1={boxCenterY}
            y2={boxCenterY}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.85}
          >
            <title>{`Min: ${formatDamage(min)}\nMax: ${formatDamage(max)}`}</title>
          </line>
          {/* Whisker caps */}
          <line
            x1={minX}
            x2={minX}
            y1={whiskerLineY1}
            y2={whiskerLineY2}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.85}
          />
          <line
            x1={maxX}
            x2={maxX}
            y1={whiskerLineY1}
            y2={whiskerLineY2}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.85}
          />

          {/* Box */}
          <rect
            x={q1X}
            y={boxCenterY - boxHeight / 2}
            width={boxWidth}
            height={boxHeight}
            fill={color}
            fillOpacity={0.2}
            stroke={color}
            strokeWidth={2}
            rx={3}
          >
            <title>{`Q1: ${formatDamage(q1)}\nQ3: ${formatDamage(q3)}`}</title>
          </rect>

          {/* Median */}
          <line
            x1={medianX}
            x2={medianX}
            y1={whiskerLineY1}
            y2={whiskerLineY2}
            stroke={color}
            strokeWidth={2.5}
          >
            <title>{`Median: ${formatDamage(median)}`}</title>
          </line>

          {/* Axis ticks */}
          {axisTicks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={axisY}
                y2={axisY + 5}
                stroke="var(--card-border)"
                strokeWidth={1}
              />
              <text
                x={tick.x}
                y={axisY + 5 + valueFontSize}
                fontSize={valueFontSize}
                fill="var(--text-secondary)"
                textAnchor={tick.align}
              >
                {formatDamage(tick.value)}
              </text>
              <text
                x={tick.x}
                y={axisY + 5 + valueFontSize + labelFontSize * 0.9}
                fontSize={labelFontSize * 0.8}
                fill="var(--text-secondary)"
                textAnchor={tick.align}
                className="uppercase"
              >
                {tick.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-[var(--text-secondary)]">
        <div>
          <div className="font-semibold text-[var(--text-primary)]">
            {formatDamage(min)}
          </div>
          <div>Min</div>
        </div>
        <div>
          <div className="font-semibold text-[var(--text-primary)]">
            {formatDamage(q1)}
          </div>
          <div>Q1</div>
        </div>
        <div>
          <div className="font-semibold text-[var(--text-primary)]">
            {formatDamage(median)}
          </div>
          <div>Median</div>
        </div>
        <div>
          <div className="font-semibold text-[var(--text-primary)]">
            {formatDamage(q3)}
          </div>
          <div>Q3</div>
        </div>
        <div>
          <div className="font-semibold text-[var(--text-primary)]">
            {formatDamage(max)}
          </div>
          <div>Max</div>
        </div>
      </div>
    </div>
  )
}
