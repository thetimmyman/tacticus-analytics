'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('hooks.usePerformance')

interface PerformanceOptions {
  threshold?: number // Log if render takes longer than this (ms)
  logProps?: boolean // Include props in performance logs
  trackRerenders?: boolean // Track unnecessary re-renders
}

export function usePerformance(
  componentName: string,
  options: PerformanceOptions = {}
) {
  const {
    threshold = 16, // 1 frame at 60fps
    logProps = false,
    trackRerenders = true
  } = options

  const renderCount = useRef(0)
  const renderStartTime = useRef<number>(0)
  const lastProps = useRef<Record<string, unknown>>({})

  renderStartTime.current = performance.now()

  useEffect(() => {
    const renderEndTime = performance.now()
    const renderTime = renderEndTime - renderStartTime.current
    renderCount.current++

    if (renderTime > threshold) {
      logger.warn(
        `[Performance] ${componentName} slow render: ${renderTime.toFixed(2)}ms`
      )

      if (logProps && lastProps.current) {
        logger.debug({ data: lastProps.current }, 'Props:')
      }
    }

    if (
      trackRerenders &&
      renderCount.current > 2 &&
      process.env.NODE_ENV === 'development'
    ) {
      logger.debug(
        `[Performance] ${componentName} re-rendered ${renderCount.current} times`
      )
    }
  })

  return {
    renderCount: renderCount.current,
    markStart: () => {
      renderStartTime.current = performance.now()
    },
    markEnd: () => performance.now() - renderStartTime.current
  }
}

export function useAsyncPerformance() {
  const timers = useRef<Map<string, number>>(new Map())

  const startTimer = useCallback((name: string) => {
    timers.current.set(name, performance.now())
  }, [])

  const endTimer = useCallback((name: string): number | null => {
    const startTime = timers.current.get(name)
    if (!startTime) {
      logger.warn(`[Performance] No timer found for: ${name}`)
      return null
    }

    const duration = performance.now() - startTime
    timers.current.delete(name)

    if (duration > 100) {
      logger.warn(`[Performance] ${name} took ${duration.toFixed(2)}ms`)
    }

    return duration
  }, [])

  const measureAsync = useCallback(
    async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      startTimer(name)
      try {
        const result = await fn()
        const duration = endTimer(name)
        if (duration && duration > 500) {
          logger.warn(
            `[Performance] Async operation '${name}' took ${duration.toFixed(2)}ms`
          )
        }
        return result
      } catch (error) {
        endTimer(name)
        throw error
      }
    },
    [startTimer, endTimer]
  )

  return {
    startTimer,
    endTimer,
    measureAsync
  }
}

export function useMemoryMonitor(componentName: string, threshold = 50) {
  const lastWarnRef = useRef<number>(0)
  useEffect(() => {
    if (!('memory' in performance) || process.env.NODE_ENV !== 'development') {
      return
    }

    const checkMemory = () => {
      interface PerformanceMemory {
        usedJSHeapSize: number
        totalJSHeapSize: number
        jsHeapSizeLimit: number
      }

      const performanceWithMemory = performance as Performance & {
        memory?: PerformanceMemory
      }
      const memory = performanceWithMemory.memory

      if (!memory) return

      const usedMB = memory.usedJSHeapSize / 1048576
      const totalMB = memory.totalJSHeapSize / 1048576
      const percentUsed = (usedMB / totalMB) * 100

      if (percentUsed > threshold) {
        const now = performance.now()
        const warnInterval = 10000
        if (now - lastWarnRef.current > warnInterval) {
          logger.warn(
            `[Memory] ${componentName} high memory usage: ${usedMB.toFixed(2)}MB / ${totalMB.toFixed(2)}MB (${percentUsed.toFixed(1)}%)`
          )
          lastWarnRef.current = now
        }
      }
    }

    checkMemory()

    return () => {
      checkMemory()
    }
  }, [componentName, threshold])
}
