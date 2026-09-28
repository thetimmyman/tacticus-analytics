import React, { memo } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.performance.PerformanceWrapper'
)

type DebouncedInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
> & {
  value: string
  onChange: (value: string) => void
  delay?: number
}

type OptimizedImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'alt' | 'loading' | 'decoding'
> & {
  src: string
  alt: string
  width?: number
  height?: number
  lazy?: boolean
}

export const SkeletonLoader = memo(({ height = 200 }: { height?: number }) => (
  <div className="animate-pulse">
    <div
      className="bg-slate-800/50 rounded-lg"
      style={{ height: `${height}px` }}
    />
  </div>
))
SkeletonLoader.displayName = 'SkeletonLoader'

export const VirtualScrollWrapper = memo(
  ({
    children,
    containerHeight = 600
  }: {
    children: React.ReactNode
    containerHeight?: number
  }) => (
    <div
      className="virtual-scroll-container overflow-y-auto"
      style={{ height: `${containerHeight}px` }}
    >
      {children}
    </div>
  )
)
VirtualScrollWrapper.displayName = 'VirtualScrollWrapper'

export const DebouncedInput = memo(
  ({ value, onChange, delay = 300, ...props }: DebouncedInputProps) => {
    const [localValue, setLocalValue] = React.useState(value)
    const timeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined)

    React.useEffect(() => {
      setLocalValue(value)
    }, [value])

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value
        setLocalValue(newValue)

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }

        timeoutRef.current = setTimeout(() => {
          onChange(newValue)
        }, delay)
      },
      [onChange, delay]
    )

    return <input {...props} value={localValue} onChange={handleChange} />
  }
)
DebouncedInput.displayName = 'DebouncedInput'

export const LazyLoadWrapper = memo(
  ({
    children,
    threshold = 0.1,
    rootMargin = '50px'
  }: {
    children: React.ReactNode
    threshold?: number
    rootMargin?: string
  }) => {
    const [isVisible, setIsVisible] = React.useState(false)
    const ref = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          const [entry] = entries
          if (!entry) return
          if (entry.isIntersecting) {
            setIsVisible(true)
            observer.disconnect()
          }
        },
        { threshold, rootMargin }
      )

      if (ref.current) {
        observer.observe(ref.current)
      }

      return () => observer.disconnect()
    }, [threshold, rootMargin])

    return <div ref={ref}>{isVisible ? children : <SkeletonLoader />}</div>
  }
)
LazyLoadWrapper.displayName = 'LazyLoadWrapper'

export const OptimizedImage = memo(
  ({ src, alt, width, height, lazy = true, ...props }: OptimizedImageProps) => (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      {...props}
    />
  )
)
OptimizedImage.displayName = 'OptimizedImage'

export function withPerformanceMonitoring<
  T extends Record<string, unknown> = Record<string, unknown>
>(Component: React.ComponentType<T>, componentName: string) {
  const WrappedComponent = memo((props: T) => {
    React.useEffect(() => {
      if (typeof window !== 'undefined' && window.performance) {
        const startTime = performance.now()

        return () => {
          const endTime = performance.now()
          const renderTime = endTime - startTime

          if (renderTime > 100) {
            logger.warn(
              `[Performance] ${componentName} took ${renderTime.toFixed(2)}ms to render`
            )
          }
        }
      }
      return undefined
    }, [])

    return <Component {...props} />
  })

  WrappedComponent.displayName = `withPerformanceMonitoring(${componentName})`
  return WrappedComponent
}

export function batchedUpdates(callback: () => void) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    requestIdleCallback(callback)
  } else {
    setTimeout(callback, 0)
  }
}
