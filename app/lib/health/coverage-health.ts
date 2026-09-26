/** Stub (feature descoped); types stay exported for consumers. */

export interface CoverageMetrics {
  statements: number
  branches: number
  functions: number
  lines: number
  totalTests: number
  passingTests: number
  failingTests: number
  recordedAt: Date
}

export interface CoverageHealthResults {
  current: CoverageMetrics | null
  previous: CoverageMetrics | null
  trend: 'improving' | 'declining' | 'stable' | 'unknown'
  belowThreshold: boolean
  threshold: number
  checked: boolean
}

export async function runCoverageHealthChecks(): Promise<CoverageHealthResults> {
  return {
    current: null,
    previous: null,
    trend: 'unknown',
    belowThreshold: false,
    threshold: 80,
    checked: false
  }
}
