import type { ReactNode } from 'react'

/**
 * Error-first, then loading, then content, with no wrapper element. Not for
 * components that check loading before error (e.g. MapsClient).
 */
export interface DataStateProps {
  error: unknown
  isLoading: boolean
  errorUI: ReactNode
  skeleton: ReactNode
  children: ReactNode
}

export function DataState({
  error,
  isLoading,
  errorUI,
  skeleton,
  children
}: DataStateProps): ReactNode {
  if (error) {
    return errorUI
  }
  if (isLoading) {
    return skeleton
  }
  return children
}
