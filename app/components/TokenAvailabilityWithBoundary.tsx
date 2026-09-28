'use client'
import { ErrorBoundary } from '@/app/components/error/ErrorBoundary'
import TokenAvailability from '@/app/components/TokenAvailability'
import { AlertCircle } from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { useRouter } from 'next/navigation'

interface TokenAvailabilityErrorFallbackProps {
  resetErrorBoundary: () => void
}

function TokenAvailabilityErrorFallback({
  resetErrorBoundary
}: TokenAvailabilityErrorFallbackProps) {
  const router = useRouter()
  return (
    <div className="border border-(--card-border) bg-black/30">
      <div className="flex items-center justify-between border-b border-(--card-border) bg-linear-to-r from-[color-mix(in_srgb,var(--accent)_10%,transparent)] to-transparent px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="text-(--accent)">
            <AlertCircle className="h-4 w-4" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary-wh40k">
            Token Availability - Error
          </h3>
        </div>
      </div>

      <div className="p-4">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-yellow-600 mx-auto mb-3" />
          <h4 className="font-medium text-yellow-800 mb-2">
            Token Data Unavailable
          </h4>
          <p className="text-yellow-700 text-sm mb-4">
            Unable to load token information. This might be due to API key
            configuration or a temporary connection issue.
          </p>
          <div className="flex gap-2 justify-center">
            <Button size="sm" variant="outline" onClick={resetErrorBoundary}>
              Retry
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push('/api-keys')}
            >
              Check API Key
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface TokenAvailabilityProps {
  guildRaidTokens?: {
    current: number
    max: number
    nextInSeconds: number | null
  }
  bombTokens?: {
    current: number
    max: number
    nextInSeconds: number | null
  }
  hasPlayerApiKey?: boolean
  onLiveTokens?: (
    guildRaid: {
      current: number
      max: number
      nextInSeconds: number | null
    },
    bomb?: {
      current: number
      max: number
      nextInSeconds: number | null
    } | null
  ) => void
}

export default function TokenAvailabilityWithBoundary(
  props: TokenAvailabilityProps
) {
  return (
    <ErrorBoundary
      section="Token Availability"
      fallbackRender={TokenAvailabilityErrorFallback}
      // Stable fallback with manual Retry: auto-reset would loop a failing panel every 30s.
      autoReset={false}
    >
      <TokenAvailability {...props} />
    </ErrorBoundary>
  )
}
