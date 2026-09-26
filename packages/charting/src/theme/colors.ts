export const CHART_PALETTE = {
  emerald: '#10b981',
  blue: '#3b82f6',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
  cyan: '#06b6d4',
  pink: '#ec4899',
  lime: '#84cc16',
  orange: '#f97316',
  teal: '#14b8a6',
  violet: '#8b5cf6',
  yellow: '#fbbf24'
} as const

export const GRID_COLORS = {
  dark: '#374151',
  medium: '#4b5563',
  light: '#6b7280'
} as const

export const AXIS_COLORS = {
  dark: '#9ca3af',
  medium: '#d1d5db',
  light: '#e5e7eb'
} as const

export function getChartPalette(count: number = 8): string[] {
  const colors = [
    CHART_PALETTE.emerald,
    CHART_PALETTE.blue,
    CHART_PALETTE.amber,
    CHART_PALETTE.red,
    CHART_PALETTE.purple,
    CHART_PALETTE.cyan,
    CHART_PALETTE.pink,
    CHART_PALETTE.lime
  ]

  const result: string[] = []
  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length] ?? colors[0] ?? '#ffffff')
  }
  return result
}

export function getBossDistributionPalette(count: number = 7): string[] {
  const colors = [
    CHART_PALETTE.blue,
    CHART_PALETTE.emerald,
    CHART_PALETTE.orange,
    CHART_PALETTE.red,
    CHART_PALETTE.purple,
    CHART_PALETTE.cyan,
    CHART_PALETTE.yellow,
    CHART_PALETTE.pink,
    CHART_PALETTE.violet,
    CHART_PALETTE.teal
  ]

  const result: string[] = []
  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length] ?? colors[0] ?? '#ffffff')
  }
  return result
}

export function withOpacity(color: string, opacity: number): string {
  if (color.includes('var(')) {
    return `rgb(from ${color} r g b / ${opacity})`
  }

  const hex = color.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)

  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export function getContrastTextColor(backgroundColor: string): string {
  if (backgroundColor.includes('var(')) {
    return 'var(--text-primary)'
  }

  const hex = backgroundColor.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#ffffff'
}
