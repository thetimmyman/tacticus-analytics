import {
  CHART_PALETTE,
  GRID_COLORS,
  AXIS_COLORS,
  getChartPalette
} from './colors'

export interface ChartTheme {
  primary: string
  secondary: string
  tertiary: string
  quaternary: string
  grid: string
  axis: string
  axisTick: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  legendText: string
  seriesColors: string[]
}

export interface GuildThemeConfig {
  primary: string
  secondary: string
  accent: string
  text: {
    primary: string
    secondary: string
    accent: string
  }
  cardBorder: string
}

const DARK_THEME_CODES = ['RG', 'NL', 'BT']

function isThemeDark(themeCode?: string): boolean {
  if (!themeCode) return false
  return DARK_THEME_CODES.includes(themeCode)
}

export function getChartTheme(
  themeCode?: string,
  themeConfig?: GuildThemeConfig
): ChartTheme {
  const isDark = isThemeDark(themeCode)

  if (!themeConfig) {
    return {
      primary: CHART_PALETTE.emerald,
      secondary: CHART_PALETTE.blue,
      tertiary: CHART_PALETTE.amber,
      quaternary: CHART_PALETTE.red,
      grid: GRID_COLORS.dark,
      axis: AXIS_COLORS.dark,
      axisTick: AXIS_COLORS.dark,
      tooltipBg: 'var(--dropdown-bg-solid)',
      tooltipBorder: 'var(--card-border)',
      tooltipText: 'var(--text-primary)',
      legendText: '#cbd5e1',
      seriesColors: getChartPalette(8)
    }
  }

  if (isDark) {
    return {
      primary: CHART_PALETTE.emerald,
      secondary: CHART_PALETTE.blue,
      tertiary: CHART_PALETTE.amber,
      quaternary: CHART_PALETTE.red,
      grid: GRID_COLORS.medium,
      axis: AXIS_COLORS.medium,
      axisTick: AXIS_COLORS.medium,
      tooltipBg: 'var(--dropdown-bg-solid)',
      tooltipBorder: 'var(--card-border)',
      tooltipText: 'var(--text-primary)',
      legendText: AXIS_COLORS.light,
      seriesColors: getChartPalette(8)
    }
  }

  return {
    primary: themeConfig.primary,
    secondary: themeConfig.secondary,
    tertiary: themeConfig.accent,
    quaternary: themeConfig.text.accent,
    grid: '#475569',
    axis: themeConfig.text.secondary,
    axisTick: themeConfig.text.secondary,
    tooltipBg: 'var(--dropdown-bg-solid)',
    tooltipBorder: 'var(--card-border)',
    tooltipText: 'var(--text-primary)',
    legendText: themeConfig.text.primary,
    seriesColors: getChartPalette(8)
  }
}

export function getSeriesColor(index: number, theme?: ChartTheme): string {
  const colors = theme?.seriesColors ?? getChartPalette(8)
  return colors[index % colors.length] ?? colors[0] ?? '#ffffff'
}

export const DEFAULT_CHART_THEME = getChartTheme()
