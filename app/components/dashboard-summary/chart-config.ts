import { getChartPalette } from '@tacticus/charting/theme'
import { getTooltipStyles } from '@tacticus/charting/tooltip'
import {
  DEFAULT_AXIS_STYLES,
  DEFAULT_GRID_STYLES,
  CHART_MARGINS
} from '@tacticus/charting/styles'

export const COLORS = getChartPalette(8)
export const tooltipStyles = getTooltipStyles().contentStyle
export const axisStyles = DEFAULT_AXIS_STYLES
export const gridStyles = DEFAULT_GRID_STYLES
export const lineChartMargins = { ...CHART_MARGINS.default, bottom: 48 }
