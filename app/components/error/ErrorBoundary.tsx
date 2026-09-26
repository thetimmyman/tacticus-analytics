'use client'

import { Component, ErrorInfo, ReactNode, type ComponentType } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.error.ErrorBoundary')
import { parseError, type ParsedError } from '@tacticus/app-core/errors'
import { getVersionInfo } from '@tacticus/app-core/error-handler'
import { AlertTriangle, RefreshCcw, Home, Bug } from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { authConfig } from '@/app/lib/auth/config'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { generateId } from '@/app/lib/utils/id-generation'
import { resolveChunkReloadOutcome } from '@/app/lib/client/chunk-reload'

export interface ErrorFallbackRenderProps {
  error: ParsedError | null
  resetErrorBoundary: () => void
  section?: string
}

interface Props {
  children: ReactNode
  fallback?: ReactNode
  fallbackRender?: ComponentType<ErrorFallbackRenderProps>
  section?: string
  onError?: (error: ParsedError, errorInfo: ErrorInfo) => void
  showDetails?: boolean
  resetKeys?: Array<string | number>
  resetOnPropsChange?: boolean
  /**
   * When false, the fallback stays until an explicit reset instead of retrying every
   * 30s; auto-reset turns a persistent throw into a remount loop that spams Sentry.
   */
  autoReset?: boolean
}

interface State {
  hasError: boolean
  error: ParsedError | null
  errorInfo: ErrorInfo | null
  errorId: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: number | null = null

  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null
    }
  }

  static getDerivedStateFromError(error: Error): State {
    const parsedError = parseError(error)
    const errorId = generateId('error', 9)

    return {
      hasError: true,
      error: parsedError,
      errorInfo: null,
      errorId
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // ChunkLoadError = stale chunk after a deploy. This boundary captures to Sentry itself,
    // so it uses resolveChunkReloadOutcome() rather than the chunk-reload guard.
    const chunkReloadOutcome = resolveChunkReloadOutcome(error)

    if (chunkReloadOutcome === 'attempted') {
      // Reload triggered; auto-recovered chunk errors are not reported.
      return
    }

    const parsedError = parseError(error)
    const versionInfo = getVersionInfo()

    logger.error(
      {
        error: parsedError,
        errorInfo,
        errorId: this.state.errorId,
        componentStack: errorInfo.componentStack,
        errorBoundary: this.constructor.name,
        version: versionInfo
      },
      'ErrorBoundary caught an error:'
    )

    // One Sentry capture of the original Error; parseError()'s plain object mis-groups.
    captureSentryException(error, {
      tags: {
        component: 'ErrorBoundary',
        boundary: this.constructor.name,
        // App-wide tag so deploy churn groups consistently.
        ...(chunkReloadOutcome === 'suppressed'
          ? { chunk_reload: 'suppressed' }
          : {})
      },
      extra: {
        errorId: this.state.errorId,
        componentStack: errorInfo.componentStack,
        version: versionInfo,
        message: error.message,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : undefined
      }
    })

    this.setState({ errorInfo })
    this.scheduleReset()

    if (this.props.onError) {
      this.props.onError(parsedError, errorInfo)
    }
  }

  override componentDidUpdate(prevProps: Props) {
    const { resetKeys, resetOnPropsChange } = this.props
    const { hasError } = this.state

    if (resetOnPropsChange && hasError) {
      if (prevProps.children !== this.props.children) {
        this.resetError()
      }
    }

    if (resetKeys && hasError) {
      const prevResetKeys = prevProps.resetKeys || []
      if (resetKeys.some((key, index) => key !== prevResetKeys[index])) {
        this.resetError()
      }
    }
  }

  override componentWillUnmount() {
    if (this.resetTimeoutId) {
      window.clearTimeout(this.resetTimeoutId)
    }
  }

  private scheduleReset = () => {
    if (this.props.autoReset === false) return
    this.resetTimeoutId = window.setTimeout(() => {
      this.resetError()
    }, 30000)
  }

  private resetError = () => {
    if (this.resetTimeoutId) {
      window.clearTimeout(this.resetTimeoutId)
      this.resetTimeoutId = null
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null
    })
  }

  private getErrorDescription = (error: ParsedError): string => {
    if (error.code) {
      switch (error.code) {
        case 'UNAUTHORIZED':
          return '++ Clearance denied ++ You do not have permission to access this resource.'
        case 'FORBIDDEN':
          return '++ Sanctum sealed ++ Access to this resource is forbidden.'
        case 'SESSION_EXPIRED':
          return '++ Communion lapsed ++ Your session has expired. Please log in again.'
        default:
          return (
            error.message ||
            '++ Cogitator fault ++ An unexpected error occurred.'
          )
      }
    }
    return (
      error.message || '++ Cogitator fault ++ An unexpected error occurred.'
    )
  }

  private reload = () => {
    window.location.reload()
  }

  private goHome = () => {
    window.location.href = authConfig.redirects.afterLogin || '/'
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender) {
        const Fallback = this.props.fallbackRender
        return (
          <Fallback
            error={this.state.error}
            resetErrorBoundary={this.resetError}
            section={this.props.section}
          />
        )
      }

      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error, errorId } = this.state
      const isDev = process.env.NODE_ENV === 'development'
      const showDetails = this.props.showDetails ?? isDev

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-red-500/20 p-6 text-center">
            {/* Error Icon */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
            </div>

            {/* Error Title */}
            <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
              ++ Cogitator fault ++ The Machine Spirit faltered.
            </h2>

            {/* Error Description */}
            <p className="text-[var(--text-secondary)] mb-4">
              {error
                ? this.getErrorDescription(error)
                : 'An unexpected error occurred.'}
            </p>

            {/* Error ID for support */}
            {errorId && (
              <p className="text-xs text-[var(--text-secondary)] mb-4 font-mono">
                Error ID: {errorId}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 justify-center mb-4">
              <Button
                onClick={this.resetError}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" />
                Try Again
              </Button>

              <Button
                onClick={this.goHome}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                Go Home
              </Button>

              <Button
                onClick={this.reload}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" />
                Reload
              </Button>
            </div>

            {/* Development Details */}
            {showDetails && error && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-sm text-[var(--text-secondary)] hover:text-[var(--text-secondary)] flex items-center gap-2">
                  <Bug className="w-4 h-4" />
                  Technical Details
                </summary>
                <div className="mt-2 p-3 bg-[var(--bg-primary)] rounded border text-xs">
                  <div className="mb-2">
                    <strong className="text-red-400">Error:</strong>
                    <pre className="text-[var(--text-secondary)] whitespace-pre-wrap mt-1">
                      {error.message}
                    </pre>
                  </div>
                  {error.stack && (
                    <div>
                      <strong className="text-red-400">Stack:</strong>
                      <pre className="text-[var(--text-secondary)] whitespace-pre-wrap mt-1 text-xs">
                        {error.stack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Support Message */}
            <p className="text-xs text-[var(--text-secondary)] mt-4">
              If the fault persists, transmit the Error ID above to the
              Tech-Priests.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
