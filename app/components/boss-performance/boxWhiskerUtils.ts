export interface BoxWhiskerStats {
  name: string
  min: number
  q1: number
  median: number
  q3: number
  max: number
  sampleSize: number
}

function calculatePercentile(sortedValues: number[], percentile: number) {
  if (sortedValues.length === 0) {
    return 0
  }

  const index = (sortedValues.length - 1) * percentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)

  const lowerValue = sortedValues[lowerIndex] ?? 0
  const upperValue = sortedValues[upperIndex] ?? lowerValue

  if (lowerIndex === upperIndex) {
    return lowerValue
  }

  const weight = index - lowerIndex
  return lowerValue * (1 - weight) + upperValue * weight
}

export function buildBoxWhiskerStats(
  name: string,
  rawValues: number[]
): BoxWhiskerStats | null {
  const filtered = rawValues.filter(
    (value) => Number.isFinite(value) && value > 0
  )
  if (filtered.length === 0) {
    return null
  }

  const sorted = filtered.slice().sort((a, b) => a - b)
  const min = sorted[0] ?? 0
  const max = sorted[sorted.length - 1] ?? min
  const q1 = calculatePercentile(sorted, 0.25)
  const median = calculatePercentile(sorted, 0.5)
  const q3 = calculatePercentile(sorted, 0.75)

  return {
    name,
    min,
    q1,
    median,
    q3,
    max,
    sampleSize: sorted.length
  }
}
