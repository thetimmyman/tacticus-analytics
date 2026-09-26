// Locale defaults to `en-US` (no hydration drift); pass `locale` only behind an SSR guard.

const DEFAULT_LOCALE = 'en-US'

const standardFormatter = new Intl.NumberFormat(DEFAULT_LOCALE)
const percentFormatterCache = new Map<string, Intl.NumberFormat>()

export type NumberFormatStyle = 'standard' | 'compact'

export interface NumberFormatOptions {
  style?: NumberFormatStyle
  /** Compact form only; standard is integer-rounded. */
  decimals?: number
  locale?: string
}

export function formatNumber(
  value: number | null | undefined,
  options: NumberFormatOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0'
  }

  const { style = 'standard', decimals = 1, locale } = options

  if (style === 'compact') {
    const absValue = Math.abs(value)
    const sign = value < 0 ? '-' : ''

    // Rounding can push a value to 1000 ("1000.0K"); promote to the next tier.
    const tiers = [
      { scale: 1_000_000_000, suffix: 'B' },
      { scale: 1_000_000, suffix: 'M' },
      { scale: 1_000, suffix: 'K' }
    ]
    for (let i = 0; i < tiers.length; i++) {
      const { scale, suffix } = tiers[i]!
      if (absValue >= scale) {
        const mantissa = (absValue / scale).toFixed(decimals)
        if (Number(mantissa) >= 1000 && i > 0) {
          const bigger = tiers[i - 1]!
          return `${sign}${(absValue / bigger.scale).toFixed(decimals)}${bigger.suffix}`
        }
        return `${sign}${mantissa}${suffix}`
      }
    }

    if (Number(absValue.toFixed(decimals)) >= 1000) {
      return `${sign}${(absValue / 1_000).toFixed(decimals)}K`
    }
    return `${sign}${absValue
      .toFixed(decimals)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1')}`
  }

  if (locale && locale !== DEFAULT_LOCALE) {
    return new Intl.NumberFormat(locale).format(Math.round(value))
  }
  return standardFormatter.format(Math.round(value))
}

/** Input is a 0..1 fraction unless `multiplied: true` (0..100). */
export function formatPercentage(
  value: number | null | undefined,
  options: { decimals?: number; multiplied?: boolean; locale?: string } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0%'
  }

  const { decimals = 0, multiplied = false, locale = DEFAULT_LOCALE } = options
  const fraction = multiplied ? value / 100 : value

  const cacheKey = `${locale}:${decimals}`
  let formatter = percentFormatterCache.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })
    percentFormatterCache.set(cacheKey, formatter)
  }
  return formatter.format(fraction)
}
