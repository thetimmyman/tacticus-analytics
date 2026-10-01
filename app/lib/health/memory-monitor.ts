import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('memory-monitor')

export interface MemoryThresholds {
  warningPercent: number
  criticalPercent: number
  extremePercent: number
}

export type MemoryStatusLevel = 'healthy' | 'warning' | 'critical' | 'extreme'
export type MemoryTrend = 'stable' | 'growing' | 'shrinking'

export interface MemoryStatus {
  usedMB: number
  totalMB: number
  rssMB: number
  externalMB: number
  arrayBuffersMB: number
  usedPercent: number
  status: MemoryStatusLevel
  trend: MemoryTrend
  leakSuspected: boolean
  trendDetails: {
    samplesCollected: number
    growthRateMBPerMinute: number
    averageUsedMB: number
  }
}

export interface HeapBreakdown {
  heapUsedMB: number
  heapTotalMB: number
  externalMB: number
  arrayBuffersMB: number
  rssMB: number
}

const DEFAULT_THRESHOLDS: MemoryThresholds = {
  warningPercent: 70,
  criticalPercent: 85,
  extremePercent: 95
}

const LEAK_DETECTION_GROWTH_THRESHOLD = 10
const LEAK_DETECTION_MIN_SAMPLES = 5

export class MemoryMonitor {
  private samples: Array<{ usedMB: number; timestamp: number }> = []
  private readonly maxSamples: number
  private readonly thresholds: MemoryThresholds
  private readonly containerLimitMB: number

  constructor(options?: {
    maxSamples?: number
    thresholds?: Partial<MemoryThresholds>
    containerLimitMB?: number
  }) {
    this.maxSamples = options?.maxSamples ?? 10
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options?.thresholds }
    const isDevMode = process.env.NODE_ENV === 'development'
    const envLimit = process.env.CONTAINER_MEMORY_LIMIT_MB
      ? parseInt(process.env.CONTAINER_MEMORY_LIMIT_MB, 10)
      : undefined
    const defaultLimit = isDevMode ? 4096 : 2048
    this.containerLimitMB =
      options?.containerLimitMB ?? envLimit ?? defaultLimit
  }

  checkMemory(): MemoryStatus {
    const usage = process.memoryUsage()
    const now = Date.now()

    const totalMB = Math.round(usage.heapTotal / 1024 / 1024)
    const rssMB = Math.round(usage.rss / 1024 / 1024)
    const externalMB = Math.round(usage.external / 1024 / 1024)
    const arrayBuffersMB = Math.round(usage.arrayBuffers / 1024 / 1024)

    const effectiveLimit = Math.max(totalMB, this.containerLimitMB)
    const usedPercent = (rssMB / effectiveLimit) * 100

    this.samples.push({ usedMB: rssMB, timestamp: now })
    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }

    const status = this.getStatus(usedPercent)
    const trend = this.getTrend()
    const leakSuspected = this.detectLeak()
    const trendDetails = this.getTrendDetails()

    if (status === 'warning') {
      logger.warn(
        {
          usedMB: rssMB,
          totalMB: effectiveLimit,
          usedPercent,
          trend,
          leakSuspected
        },
        'Memory warning threshold exceeded'
      )
    } else if (status === 'critical') {
      logger.error(
        {
          usedMB: rssMB,
          totalMB: effectiveLimit,
          usedPercent,
          trend,
          leakSuspected
        },
        'Memory critical threshold exceeded'
      )
    } else if (status === 'extreme') {
      logger.error(
        {
          usedMB: rssMB,
          totalMB: effectiveLimit,
          usedPercent,
          trend,
          leakSuspected
        },
        'Memory extreme threshold exceeded - recovery needed'
      )
    }

    if (leakSuspected) {
      logger.warn(
        {
          growthRate: trendDetails.growthRateMBPerMinute,
          samples: trendDetails.samplesCollected
        },
        'Potential memory leak detected - sustained growth observed'
      )
    }

    return {
      usedMB: rssMB,
      totalMB: effectiveLimit,
      rssMB,
      externalMB,
      arrayBuffersMB,
      usedPercent,
      status,
      trend,
      leakSuspected,
      trendDetails
    }
  }

  getHeapBreakdown(): HeapBreakdown {
    const usage = process.memoryUsage()
    return {
      heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
      externalMB: Math.round(usage.external / 1024 / 1024),
      arrayBuffersMB: Math.round(usage.arrayBuffers / 1024 / 1024),
      rssMB: Math.round(usage.rss / 1024 / 1024)
    }
  }

  getSamples(): Array<{ usedMB: number; timestamp: number }> {
    return [...this.samples]
  }

  clearSamples(): void {
    this.samples = []
    logger.debug('Memory samples cleared')
  }

  private getStatus(usedPercent: number): MemoryStatusLevel {
    if (usedPercent >= this.thresholds.extremePercent) {
      return 'extreme'
    }
    if (usedPercent >= this.thresholds.criticalPercent) {
      return 'critical'
    }
    if (usedPercent >= this.thresholds.warningPercent) {
      return 'warning'
    }
    return 'healthy'
  }

  private getTrend(): MemoryTrend {
    if (this.samples.length < 3) {
      return 'stable'
    }

    const recent = this.samples.slice(-3)
    const firstSample = recent[0]
    const lastSample = recent[recent.length - 1]
    if (!firstSample || !lastSample) {
      return 'stable'
    }
    const first = firstSample.usedMB
    const last = lastSample.usedMB

    const changePercent = ((last - first) / first) * 100

    if (changePercent > 5) {
      return 'growing'
    }
    if (changePercent < -5) {
      return 'shrinking'
    }
    return 'stable'
  }

  private detectLeak(): boolean {
    if (this.samples.length < LEAK_DETECTION_MIN_SAMPLES) {
      return false
    }

    const recent = this.samples.slice(-LEAK_DETECTION_MIN_SAMPLES)
    const first = recent[0]
    const last = recent[recent.length - 1]
    if (!first || !last) {
      return false
    }

    const growthPercent = ((last.usedMB - first.usedMB) / first.usedMB) * 100

    const elapsedMinutes = (last.timestamp - first.timestamp) / 1000 / 60

    if (
      growthPercent > LEAK_DETECTION_GROWTH_THRESHOLD &&
      elapsedMinutes >= 5
    ) {
      let sustainedGrowth = true
      for (let i = 1; i < recent.length; i++) {
        const current = recent[i]
        const previous = recent[i - 1]
        if (!current || !previous) continue
        if (current.usedMB < previous.usedMB * 0.98) {
          sustainedGrowth = false
          break
        }
      }
      return sustainedGrowth
    }

    return false
  }

  private getTrendDetails(): MemoryStatus['trendDetails'] {
    if (this.samples.length === 0) {
      return {
        samplesCollected: 0,
        growthRateMBPerMinute: 0,
        averageUsedMB: 0
      }
    }

    const sum = this.samples.reduce((acc, s) => acc + s.usedMB, 0)
    const averageUsedMB = Math.round(sum / this.samples.length)

    let growthRateMBPerMinute = 0
    if (this.samples.length >= 2) {
      const first = this.samples[0]
      const last = this.samples[this.samples.length - 1]
      if (!first || !last) {
        return {
          samplesCollected: this.samples.length,
          growthRateMBPerMinute,
          averageUsedMB
        }
      }
      const elapsedMinutes = (last.timestamp - first.timestamp) / 1000 / 60

      if (elapsedMinutes > 0) {
        growthRateMBPerMinute =
          Math.round(((last.usedMB - first.usedMB) / elapsedMinutes) * 10) / 10
      }
    }

    return {
      samplesCollected: this.samples.length,
      growthRateMBPerMinute,
      averageUsedMB
    }
  }
}

let globalMonitor: MemoryMonitor | null = null

export function getMemoryMonitor(): MemoryMonitor {
  if (!globalMonitor) {
    globalMonitor = new MemoryMonitor()
  }
  return globalMonitor
}
