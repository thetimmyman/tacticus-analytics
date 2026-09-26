import type { CSSProperties } from 'react'
import type { ChartTheme } from '../theme/chart-theme'
import { getChartTheme } from '../theme/chart-theme'

export interface TooltipStyles {
  contentStyle: CSSProperties
  labelStyle: CSSProperties
  itemStyle: CSSProperties
  wrapperStyle: CSSProperties
}

export const DEFAULT_TOOLTIP_STYLES: CSSProperties = {
  backgroundColor: 'var(--dropdown-bg-solid)',
  border: '1px solid var(--card-border)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  fontSize: '12px',
  fontFamily: 'inherit',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
}

export const DEFAULT_TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: 'var(--text-secondary)',
  fontWeight: 'bold',
  marginBottom: '4px'
}

export const DEFAULT_TOOLTIP_VALUE_STYLE: CSSProperties = {
  color: 'var(--accent)',
  fontWeight: 'normal'
}

/** Canonical Recharts tooltip props; token-driven in both light and dark themes. */
export const DEFAULT_RECHARTS_TOOLTIP_PROPS = {
  contentStyle: DEFAULT_TOOLTIP_STYLES,
  labelStyle: DEFAULT_TOOLTIP_LABEL_STYLE,
  itemStyle: DEFAULT_TOOLTIP_VALUE_STYLE,
  wrapperStyle: { zIndex: 1000 }
} satisfies TooltipStyles

export function getTooltipStyles(theme?: ChartTheme): TooltipStyles {
  const chartTheme = theme ?? getChartTheme()

  return {
    contentStyle: {
      backgroundColor: chartTheme.tooltipBg,
      border: `1px solid ${chartTheme.tooltipBorder}`,
      borderRadius: '8px',
      color: chartTheme.tooltipText,
      padding: '10px 14px',
      fontSize: '13px',
      fontWeight: 500,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
    },
    labelStyle: {
      color: chartTheme.tooltipText,
      fontWeight: 'bold',
      marginBottom: '4px'
    },
    itemStyle: {
      color: chartTheme.tooltipText,
      padding: '2px 0'
    },
    wrapperStyle: {
      zIndex: 1000
    }
  }
}

export function getThemedTooltipContent(theme?: ChartTheme): CSSProperties {
  const chartTheme = theme ?? getChartTheme()

  return {
    backgroundColor: chartTheme.tooltipBg,
    border: `1px solid ${chartTheme.tooltipBorder}`,
    borderRadius: '8px',
    color: chartTheme.tooltipText,
    padding: '10px 14px',
    fontSize: '13px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
  }
}

export function getPieTooltipStyles(): CSSProperties {
  return {
    ...DEFAULT_TOOLTIP_STYLES,
    backgroundColor: 'var(--card-bg)'
  }
}
