'use client'

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { LoadingSpinner } from './loading'

interface LazyLoadOptions {
  fallback?: ReactNode
  ssr?: boolean
}

export function LazyLoadWrapper({
  children,
  fallback = <LoadingSpinner />
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}

export function lazyLoad<TProps = any>(
  importFunc: () => Promise<{ default: ComponentType<any> }>,
  options: LazyLoadOptions = {}
): ComponentType<TProps> {
  const { fallback = <LoadingSpinner /> } = options
  const LazyComponent = lazy(importFunc)
  const LazyWrapper: ComponentType<TProps> = (props: TProps) => (
    <Suspense fallback={fallback}>
      <LazyComponent {...(props as any)} />
    </Suspense>
  )

  LazyWrapper.displayName = `LazyWrapper(${importFunc.name || 'Component'})`
  return LazyWrapper
}

export function preloadComponent<TProps>(
  importFunc: () => Promise<{ default: ComponentType<TProps> }>
) {
  const componentPromise = importFunc()

  return {
    preload: () => componentPromise,
    Component: lazy(() => componentPromise)
  }
}

export const ChartSkeleton = () => (
  <div className="animate-pulse">
    <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-sm" />
  </div>
)

export const CardSkeleton = () => (
  <div className="animate-pulse">
    <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-sm" />
  </div>
)
