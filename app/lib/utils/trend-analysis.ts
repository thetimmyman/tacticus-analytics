export function calculateLinearRegression(data: { x: number; y: number }[]): {
  slope: number
  intercept: number
} {
  if (data.length < 2) return { slope: 0, intercept: 0 }
  const n = data.length
  const sumX = data.reduce((acc, d) => acc + d.x, 0)
  const sumY = data.reduce((acc, d) => acc + d.y, 0)
  const sumXY = data.reduce((acc, d) => acc + d.x * d.y, 0)
  const sumX2 = data.reduce((acc, d) => acc + d.x * d.x, 0)
  const denominator = n * sumX2 - sumX * sumX
  if (denominator === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

/** Percentage per period (e.g. per season), positive values only. */
export function calculateCAGR(
  startValue: number,
  endValue: number,
  periods: number
): number | null {
  if (periods <= 0 || startValue <= 0 || endValue <= 0) return null
  return (Math.pow(endValue / startValue, 1 / periods) - 1) * 100
}

/** `slope` is the per-period trend for series that can be zero or negative; `cagr` is null when an endpoint is <= 0. */
export function generateTrendlineData<T>(
  data: T[],
  getValue: (item: T) => number | null | undefined,
  getX?: (item: T, index: number) => number | null | undefined
): {
  startY: number
  endY: number
  slope: number
  cagr: number | null
} | null {
  // getX gives the real season position so gaps do not distort slope or CAGR.
  const resolveX = (item: T, index: number): number => {
    const x = getX?.(item, index)
    return x != null && Number.isFinite(x) ? x : index
  }
  const validData = data
    .map((item, index) => ({ x: resolveX(item, index), y: getValue(item) }))
    .filter(
      (d): d is { x: number; y: number } => d.y != null && Number.isFinite(d.y)
    )
  if (validData.length < 2) return null
  const { slope, intercept } = calculateLinearRegression(validData)
  // Consumers interpolate across the full array, so endpoints use its first/last rows.
  const firstRow = data[0]
  const lastRow = data[data.length - 1]
  if (firstRow === undefined || lastRow === undefined) return null
  const startY = slope * resolveX(firstRow, 0) + intercept
  const endY = slope * resolveX(lastRow, data.length - 1) + intercept
  // Periods are the season span between valid endpoints, not the survivor count.
  const firstEntry = validData[0]
  const lastEntry = validData[validData.length - 1]
  if (!firstEntry || !lastEntry) return null
  const cagr = calculateCAGR(
    firstEntry.y,
    lastEntry.y,
    lastEntry.x - firstEntry.x
  )
  return { startY, endY, slope, cagr }
}

export function formatCAGR(cagr: number | null): string {
  if (cagr === null) return 'N/A'
  const sign = cagr >= 0 ? '+' : ''
  return `${sign}${cagr.toFixed(1)}%`
}

export function formatTrendPerSeason(
  slope: number | null | undefined,
  unit = ''
): string {
  if (slope == null || !Number.isFinite(slope)) return 'N/A'
  const sign = slope >= 0 ? '+' : ''
  return `${sign}${slope.toFixed(1)}${unit}`
}

export function seasonNumberX(row: { season: string }): number | null {
  const digits = String(row.season).replace(/^S/i, '').trim()
  if (digits === '') return null // Number('') is 0, not NaN
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

export function interpolateTrendValue(
  trend: { startY: number; endY: number } | null,
  index: number,
  totalCount: number
): number | undefined {
  if (!trend) return undefined
  const n = Math.max(totalCount - 1, 1)
  return trend.startY + (trend.endY - trend.startY) * (index / n)
}
