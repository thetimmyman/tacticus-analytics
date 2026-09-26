export interface TokenUsagePattern {
  hour: number
  averageEfficiency: number
  usageCount: number
  successRate: number
}

export interface OptimalUsageSuggestion {
  recommendedTime: string
  confidence: number
  reasoning: string
  urgency: 'low' | 'medium' | 'high'
  hoursUntilOptimal: number
}

export function getOptimalUsageTiming(tokenData: {
  current: number
  max: number
  nextInSeconds: number | null
  type: string
}): OptimalUsageSuggestion {
  const { current, max, nextInSeconds, type } = tokenData
  const currentHour = new Date().getHours()

  if (current === max) {
    return {
      recommendedTime: 'NOW',
      confidence: 95,
      reasoning: 'Tokens are full - use immediately to avoid waste',
      urgency: 'high',
      hoursUntilOptimal: 0
    }
  }

  if (current === 0) {
    const hoursUntilNext = nextInSeconds ? Math.ceil(nextInSeconds / 3600) : 8
    return {
      recommendedTime: `${hoursUntilNext}h`,
      confidence: 80,
      reasoning: 'No tokens available - wait for refresh',
      urgency: 'low',
      hoursUntilOptimal: hoursUntilNext
    }
  }

  switch (type.toLowerCase()) {
    case 'guild raid':
      return getGuildRaidOptimalTiming(current, max, nextInSeconds, currentHour)
    case 'arena':
      return getArenaOptimalTiming(current, max, nextInSeconds, currentHour)
    case 'bomb':
      return getBombOptimalTiming(current, max, nextInSeconds, currentHour)
    case 'onslaught':
      return getOnslaughtOptimalTiming(current, max, nextInSeconds, currentHour)
    default:
      return getGenericOptimalTiming(current, max, nextInSeconds, currentHour)
  }
}

function getGuildRaidOptimalTiming(
  current: number,
  max: number,
  nextInSeconds: number | null,
  currentHour: number
): OptimalUsageSuggestion {
  void max
  void nextInSeconds
  const optimalHours = [18, 19, 20, 21, 22] // 6 PM - 10 PM
  const isOptimalTime = optimalHours.includes(currentHour)

  if (current >= 2) {
    if (isOptimalTime) {
      return {
        recommendedTime: 'NOW',
        confidence: 90,
        reasoning: 'Prime time for coordinated guild raids (6-10 PM)',
        urgency: 'high',
        hoursUntilOptimal: 0
      }
    } else if (currentHour < 18) {
      const hoursUntil = 18 - currentHour
      return {
        recommendedTime: `${hoursUntil}h`,
        confidence: 75,
        reasoning: 'Wait for prime raid time (6 PM) for better coordination',
        urgency: 'medium',
        hoursUntilOptimal: hoursUntil
      }
    } else {
      return {
        recommendedTime: 'Soon',
        confidence: 70,
        reasoning: 'Use before daily reset to avoid wasting refresh',
        urgency: 'medium',
        hoursUntilOptimal: 1
      }
    }
  }

  return {
    recommendedTime: '2h',
    confidence: 60,
    reasoning: 'Wait to accumulate more tokens for efficient raids',
    urgency: 'low',
    hoursUntilOptimal: 2
  }
}

function getArenaOptimalTiming(
  current: number,
  max: number,
  nextInSeconds: number | null,
  currentHour: number
): OptimalUsageSuggestion {
  void nextInSeconds
  const peakHours = [18, 19, 20, 21] // Evening peak
  const offPeakHours = [9, 10, 11, 14, 15, 16] // Mid-day optimal

  const isPeakTime = peakHours.includes(currentHour)
  const isOffPeakTime = offPeakHours.includes(currentHour)

  if (current >= 10) {
    if (isOffPeakTime) {
      return {
        recommendedTime: 'NOW',
        confidence: 85,
        reasoning: 'Off-peak hours - easier opponents and better rewards',
        urgency: 'high',
        hoursUntilOptimal: 0
      }
    } else if (isPeakTime) {
      return {
        recommendedTime: '4h',
        confidence: 70,
        reasoning: 'Peak hours - wait for easier competition',
        urgency: 'low',
        hoursUntilOptimal: 4
      }
    }
  }

  if (current >= max * 0.8) {
    return {
      recommendedTime: 'Soon',
      confidence: 75,
      reasoning: 'Near capacity - use soon to avoid waste',
      urgency: 'medium',
      hoursUntilOptimal: 1
    }
  }

  return {
    recommendedTime: '3h',
    confidence: 65,
    reasoning: 'Accumulate tokens for batch arena runs',
    urgency: 'low',
    hoursUntilOptimal: 3
  }
}

function getBombOptimalTiming(
  current: number,
  max: number,
  nextInSeconds: number | null,
  currentHour: number
): OptimalUsageSuggestion {
  void max
  void nextInSeconds
  if (current === 1) {
    const resetHours = [0, 8, 16] // Typical reset times
    const nearReset = resetHours.some(
      (hour) => Math.abs(currentHour - hour) <= 1
    )

    if (nearReset) {
      return {
        recommendedTime: 'NOW',
        confidence: 90,
        reasoning: 'Use before reset to maximize benefit timing',
        urgency: 'high',
        hoursUntilOptimal: 0
      }
    }

    if (currentHour >= 18 && currentHour <= 22) {
      return {
        recommendedTime: 'NOW',
        confidence: 85,
        reasoning: 'Prime time for maximum guild coordination',
        urgency: 'high',
        hoursUntilOptimal: 0
      }
    }

    return {
      recommendedTime: '2h',
      confidence: 70,
      reasoning: 'Wait for optimal timing - bombs are too valuable to waste',
      urgency: 'medium',
      hoursUntilOptimal: 2
    }
  }

  return {
    recommendedTime: '8h',
    confidence: 50,
    reasoning: 'No bombs available - wait for refresh',
    urgency: 'low',
    hoursUntilOptimal: 8
  }
}

function getOnslaughtOptimalTiming(
  current: number,
  max: number,
  nextInSeconds: number | null,
  currentHour: number
): OptimalUsageSuggestion {
  void max
  void nextInSeconds
  const focusHours = [10, 11, 14, 15, 19, 20] // Good concentration times
  const isFocusTime = focusHours.includes(currentHour)

  if (current >= 2) {
    if (isFocusTime) {
      return {
        recommendedTime: 'NOW',
        confidence: 80,
        reasoning: 'Good focus time for challenging onslaught battles',
        urgency: 'high',
        hoursUntilOptimal: 0
      }
    }

    return {
      recommendedTime: '2h',
      confidence: 70,
      reasoning: 'Wait for better focus time to maximize performance',
      urgency: 'medium',
      hoursUntilOptimal: 2
    }
  }

  return {
    recommendedTime: '4h',
    confidence: 60,
    reasoning: 'Accumulate tokens for efficient onslaught runs',
    urgency: 'low',
    hoursUntilOptimal: 4
  }
}

function getGenericOptimalTiming(
  current: number,
  max: number,
  nextInSeconds: number | null,
  currentHour: number
): OptimalUsageSuggestion {
  void nextInSeconds
  void currentHour
  const ratio = current / max

  if (ratio >= 0.8) {
    return {
      recommendedTime: 'Soon',
      confidence: 70,
      reasoning: 'Near capacity - use to avoid waste',
      urgency: 'medium',
      hoursUntilOptimal: 1
    }
  }

  if (ratio >= 0.5) {
    return {
      recommendedTime: '2h',
      confidence: 60,
      reasoning: 'Good amount available - use when convenient',
      urgency: 'low',
      hoursUntilOptimal: 2
    }
  }

  return {
    recommendedTime: '4h',
    confidence: 50,
    reasoning: 'Low tokens - wait to accumulate more',
    urgency: 'low',
    hoursUntilOptimal: 4
  }
}

export function generateTokenEfficiencyInsights(
  tokenData: Array<{
    type: string
    current: number
    max: number
    nextInSeconds: number | null
  }>
): {
  overallEfficiency: number
  wastedTokens: number
  recommendations: string[]
  urgentActions: string[]
} {
  let overallEfficiency = 0
  let wastedTokens = 0
  const recommendations: string[] = []
  const urgentActions: string[] = []

  tokenData.forEach((token) => {
    const efficiency = token.current / token.max
    overallEfficiency += efficiency

    if (efficiency === 1) {
      wastedTokens++
      urgentActions.push(`${token.type} tokens are full - use immediately!`)
    } else if (efficiency >= 0.8) {
      recommendations.push(
        `${token.type} tokens nearly full - consider using soon`
      )
    } else if (efficiency === 0) {
      recommendations.push(`${token.type} tokens empty - wait for refresh`)
    }
  })

  overallEfficiency =
    tokenData.length > 0 ? (overallEfficiency / tokenData.length) * 100 : 0

  if (overallEfficiency < 30) {
    recommendations.push(
      'Overall low token availability - plan activities around refresh times'
    )
  } else if (overallEfficiency > 80) {
    recommendations.push(
      'High token availability - good time for active gameplay'
    )
  }

  return {
    overallEfficiency: Math.round(overallEfficiency),
    wastedTokens,
    recommendations,
    urgentActions
  }
}

export function calculateOptimalWindows(
  tokenData: Array<{
    type: string
    current: number
    max: number
    nextInSeconds: number | null
  }>
): Array<{
  type: string
  windowStart: Date
  windowEnd: Date
  confidence: number
  reason: string
}> {
  return tokenData.map((token) => {
    const suggestion = getOptimalUsageTiming(token)
    const now = new Date()
    const windowStart = new Date(
      now.getTime() + suggestion.hoursUntilOptimal * 60 * 60 * 1000
    )
    const windowEnd = new Date(windowStart.getTime() + 2 * 60 * 60 * 1000) // 2-hour window

    return {
      type: token.type,
      windowStart,
      windowEnd,
      confidence: suggestion.confidence,
      reason: suggestion.reasoning
    }
  })
}
