'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type * as Recharts from 'recharts'

// One shared lazy recharts chunk, kept out of every route's initial bundle.
const loadCharting = () => import('@tacticus/charting/components')

type ChartingModule = Awaited<ReturnType<typeof loadCharting>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts types are incompatible with ComponentType<unknown> because props vary per component
function lazy<C extends ComponentType<any>>(
  pick: (mod: ChartingModule) => unknown
): C {
  return dynamic(
    () => loadCharting().then((mod) => ({ default: pick(mod) as C })),
    { ssr: false }
  ) as unknown as C
}

export const ResponsiveContainer = lazy<typeof Recharts.ResponsiveContainer>(
  (m) => m.ResponsiveContainer
)
export const BarChart = lazy<typeof Recharts.BarChart>((m) => m.BarChart)
export const Bar = lazy<typeof Recharts.Bar>((m) => m.Bar)
export const LineChart = lazy<typeof Recharts.LineChart>((m) => m.LineChart)
export const Line = lazy<typeof Recharts.Line>((m) => m.Line)
export const AreaChart = lazy<typeof Recharts.AreaChart>((m) => m.AreaChart)
export const Area = lazy<typeof Recharts.Area>((m) => m.Area)
export const ScatterChart = lazy<typeof Recharts.ScatterChart>(
  (m) => m.ScatterChart
)
export const Scatter = lazy<typeof Recharts.Scatter>((m) => m.Scatter)
export const ComposedChart = lazy<typeof Recharts.ComposedChart>(
  (m) => m.ComposedChart
)
export const PieChart = lazy<typeof Recharts.PieChart>((m) => m.PieChart)
export const Pie = lazy<typeof Recharts.Pie>((m) => m.Pie)
export const Cell = lazy<typeof Recharts.Cell>((m) => m.Cell)
export const RadarChart = lazy<typeof Recharts.RadarChart>((m) => m.RadarChart)
export const Radar = lazy<typeof Recharts.Radar>((m) => m.Radar)
export const XAxis = lazy<typeof Recharts.XAxis>((m) => m.XAxis)
export const YAxis = lazy<typeof Recharts.YAxis>((m) => m.YAxis)
export const ZAxis = lazy<typeof Recharts.ZAxis>((m) => m.ZAxis)
export const CartesianGrid = lazy<typeof Recharts.CartesianGrid>(
  (m) => m.CartesianGrid
)
export const Tooltip = lazy<typeof Recharts.Tooltip>((m) => m.Tooltip)
export const Legend = lazy<typeof Recharts.Legend>((m) => m.Legend)
export const PolarGrid = lazy<typeof Recharts.PolarGrid>((m) => m.PolarGrid)
export const PolarAngleAxis = lazy<typeof Recharts.PolarAngleAxis>(
  (m) => m.PolarAngleAxis
)
export const PolarRadiusAxis = lazy<typeof Recharts.PolarRadiusAxis>(
  (m) => m.PolarRadiusAxis
)

export const LabelList = lazy<typeof Recharts.LabelList>((m) => m.LabelList)
export const ReferenceLine = lazy<typeof Recharts.ReferenceLine>(
  (m) => m.ReferenceLine
)

export type * from 'recharts'
