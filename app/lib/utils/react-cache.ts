import * as React from 'react'

type CacheableFn = (...args: readonly unknown[]) => unknown
type ReactCache = <F extends CacheableFn>(cb: F) => F

/** Identity fallback where React 18 lacks `react.cache`. */
export function cacheCompat<T extends CacheableFn>(fn: T): T {
  const reactCache = (React as { cache?: ReactCache }).cache
  return typeof reactCache === 'function' ? reactCache(fn) : fn
}
