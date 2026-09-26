export interface PerformanceStats {
  mean: number
  median: number
  standardDeviation: number
  variance: number
  coefficient_of_variation: number
}

export interface TrendAnalysis {
  direction: 'improving' | 'declining' | 'stable'
  strength: 'weak' | 'moderate' | 'strong'
  confidence: number
  changeRate: number
}

export interface ConsistencyScore {
  score: number // 0-100, higher is more consistent
  rating: 'excellent' | 'good' | 'fair' | 'poor'
  description: string
}

export function calculateStats(values: number[]): PerformanceStats {
  if (values.length === 0) {
    return {
      mean: 0,
      median: 0,
      standardDeviation: 0,
      variance: 0,
      coefficient_of_variation: 0
    }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length

  const midIndex = Math.floor(sorted.length / 2)
  const midHigh = sorted[midIndex] ?? 0
  const midLow = sorted[midIndex - 1] ?? midHigh
  const median = sorted.length % 2 === 0 ? (midLow + midHigh) / 2 : midHigh

  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length
  const standardDeviation = Math.sqrt(variance)
  const coefficient_of_variation =
    mean > 0 ? (standardDeviation / mean) * 100 : 0

  return {
    mean,
    median,
    standardDeviation,
    variance,
    coefficient_of_variation
  }
}

export function analyzeTrend(
  values: number[],
  timePoints?: number[]
): TrendAnalysis {
  if (values.length < 2) {
    return {
      direction: 'stable',
      strength: 'weak',
      confidence: 0,
      changeRate: 0
    }
  }

  const x = timePoints || values.map((_, i) => i)
  const n = values.length

  const sumX = x.reduce((sum, val) => sum + val, 0)
  const sumY = values.reduce((sum, val) => sum + val, 0)
  const sumXY = x.reduce((sum, val, i) => sum + val * (values[i] ?? 0), 0)
  const sumX2 = x.reduce((sum, val) => sum + val * val, 0)

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const changeRate = slope

  const meanX = sumX / n
  const meanY = sumY / n

  const numerator = x.reduce(
    (sum, val, i) => sum + (val - meanX) * ((values[i] ?? 0) - meanY),
    0
  )
  const denomX = Math.sqrt(
    x.reduce((sum, val) => sum + Math.pow(val - meanX, 2), 0)
  )
  const denomY = Math.sqrt(
    values.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0)
  )

  const correlation =
    denomX > 0 && denomY > 0 ? numerator / (denomX * denomY) : 0
  const confidence = Math.abs(correlation) * 100

  let direction: 'improving' | 'declining' | 'stable'
  if (Math.abs(slope) < 0.1) {
    direction = 'stable'
  } else if (slope > 0) {
    direction = 'improving'
  } else {
    direction = 'declining'
  }

  let strength: 'weak' | 'moderate' | 'strong'
  if (confidence < 30) {
    strength = 'weak'
  } else if (confidence < 70) {
    strength = 'moderate'
  } else {
    strength = 'strong'
  }

  return {
    direction,
    strength,
    confidence,
    changeRate
  }
}

export function calculateConsistencyScore(values: number[]): ConsistencyScore {
  if (values.length === 0) {
    return {
      score: 0,
      rating: 'poor',
      description: 'No data available'
    }
  }

  const stats = calculateStats(values)

  // Inverted coefficient of variation: higher score = more consistent.
  let score = Math.max(0, 100 - stats.coefficient_of_variation)

  if (values.length < 5) {
    score = score * 0.8
  }

  let rating: 'excellent' | 'good' | 'fair' | 'poor'
  let description: string

  if (score >= 85) {
    rating = 'excellent'
    description = 'Very consistent performance with minimal variation'
  } else if (score >= 70) {
    rating = 'good'
    description = 'Good consistency with occasional variation'
  } else if (score >= 50) {
    rating = 'fair'
    description = 'Moderate consistency with noticeable variation'
  } else {
    rating = 'poor'
    description = 'High variation, inconsistent performance'
  }

  return {
    score: Math.round(score),
    rating,
    description
  }
}

export function detectAnomalies(
  values: number[],
  threshold: number = 2
): {
  outliers: number[]
  outlierIndices: number[]
  isCurrentAnomaly: boolean
} {
  if (values.length < 3) {
    return {
      outliers: [],
      outlierIndices: [],
      isCurrentAnomaly: false
    }
  }

  const stats = calculateStats(values)
  const outliers: number[] = []
  const outlierIndices: number[] = []

  values.forEach((value, index) => {
    const zScore = Math.abs(value - stats.mean) / stats.standardDeviation
    if (zScore > threshold) {
      outliers.push(value)
      outlierIndices.push(index)
    }
  })

  const lastValue = values[values.length - 1] ?? 0
  const lastZScore = Math.abs(lastValue - stats.mean) / stats.standardDeviation
  const isCurrentAnomaly = lastZScore > threshold

  return {
    outliers,
    outlierIndices,
    isCurrentAnomaly
  }
}

export function calculateOptimalUsageTiming(
  usageHistory: Array<{
    timestamp: Date
    tokensUsed: number
    efficiency: number
  }>
): {
  optimalHour: number
  confidence: number
  reasoning: string
} {
  if (usageHistory.length < 5) {
    return {
      optimalHour: 12, // Default to noon
      confidence: 0,
      reasoning: 'Insufficient historical data for optimization'
    }
  }

  const hourlyStats: Record<number, { efficiency: number[]; count: number }> =
    {}

  usageHistory.forEach((entry) => {
    const hour = entry.timestamp.getHours()
    if (!hourlyStats[hour]) {
      hourlyStats[hour] = { efficiency: [], count: 0 }
    }
    hourlyStats[hour].efficiency.push(entry.efficiency)
    hourlyStats[hour].count++
  })

  let bestHour = 12
  let bestEfficiency = 0
  let confidence = 0

  Object.entries(hourlyStats).forEach(([hour, stats]) => {
    if (stats.count >= 2) {
      const avgEfficiency =
        stats.efficiency.reduce((sum, val) => sum + val, 0) /
        stats.efficiency.length
      if (avgEfficiency > bestEfficiency) {
        bestEfficiency = avgEfficiency
        bestHour = parseInt(hour)
        confidence = Math.min(100, (stats.count / usageHistory.length) * 100)
      }
    }
  })

  const reasoning =
    confidence > 50
      ? `Based on ${hourlyStats[bestHour]?.count || 0} historical uses at ${bestHour}:00`
      : 'Limited data - using statistical best guess'

  return {
    optimalHour: bestHour,
    confidence,
    reasoning
  }
}

export function generatePerformanceInsights(data: {
  damageValues: number[]
  tokenUsage: number[]
  timeToKill: number[]
}): {
  insights: string[]
  recommendations: string[]
  riskLevel: 'low' | 'medium' | 'high'
} {
  const insights: string[] = []
  const recommendations: string[] = []

  const damageConsistency = calculateConsistencyScore(data.damageValues)
  insights.push(
    `Damage consistency: ${damageConsistency.rating} (${damageConsistency.score}/100)`
  )

  if (damageConsistency.score < 70) {
    recommendations.push(
      'Consider standardizing team compositions for more consistent damage output'
    )
  }

  const tokenTrend = analyzeTrend(data.tokenUsage)
  insights.push(
    `Token usage trend: ${tokenTrend.direction} (${tokenTrend.confidence.toFixed(0)}% confidence)`
  )

  if (tokenTrend.direction === 'declining' && tokenTrend.confidence > 60) {
    recommendations.push(
      'Token usage is increasing - review team strength and strategy'
    )
  }

  const timeStats = calculateStats(data.timeToKill)
  if (timeStats.mean > 20) {
    insights.push('Kill times are above optimal range (>20 minutes)')
    recommendations.push(
      'Focus on improving damage output or team coordination'
    )
  }

  const anomalies = detectAnomalies(data.damageValues)
  if (anomalies.isCurrentAnomaly) {
    insights.push('Recent performance shows unusual pattern')
    recommendations.push(
      'Investigate recent changes in team composition or strategy'
    )
  }

  let riskLevel: 'low' | 'medium' | 'high' = 'low'

  if (tokenTrend.direction === 'declining' && tokenTrend.confidence > 70) {
    riskLevel = 'high'
  } else if (damageConsistency.score < 50 || anomalies.isCurrentAnomaly) {
    riskLevel = 'medium'
  }

  return {
    insights,
    recommendations,
    riskLevel
  }
}
