export interface AxisStyleConfig {
  tick: {
    fill: string
    fontSize: number
    fontFamily: string
  }
  tickLine: {
    stroke: string
    strokeWidth: number
  }
  axisLine: {
    stroke: string
    strokeWidth: number
  }
  tickMargin?: number
}

export interface GridStyleConfig {
  stroke: string
  strokeWidth: number
  strokeDasharray: string
}

export const DEFAULT_AXIS_STYLES: AxisStyleConfig = {
  tick: {
    fill: 'var(--chart-axis)',
    fontSize: 11,
    fontFamily: 'inherit'
  },
  tickLine: {
    stroke: 'var(--chart-axis)',
    strokeWidth: 1
  },
  axisLine: {
    stroke: 'var(--chart-axis)',
    strokeWidth: 2
  },
  tickMargin: 8
}

export const DEFAULT_GRID_STYLES: GridStyleConfig = {
  stroke: 'var(--chart-grid)',
  strokeWidth: 1,
  strokeDasharray: '3 3'
}

export const CHART_MARGINS = {
  default: { top: 20, right: 30, bottom: 20, left: 30 },
  compact: { top: 10, right: 15, bottom: 10, left: 15 },
  withYAxisLabel: { top: 20, right: 30, bottom: 20, left: 60 },
  horizontal: { top: 20, right: 30, left: 100, bottom: 5 }
}
