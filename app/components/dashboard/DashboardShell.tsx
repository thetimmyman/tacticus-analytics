import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import type { PlayerMapping } from '@tacticus/app-core/types'
import type { AppUser } from '@/app/types'
import Footer from '@/app/components/Footer'
import { ErrorBoundary } from '@/app/components/error/ErrorBoundary'
import { NavigationServer } from '@/app/components/NavigationServer'
import DashboardThemeWrapper from '@/app/(dashboard)/DashboardThemeWrapper'
import { RadixTooltipProvider } from '@tacticus/ui-kit/radix-tooltip'
import { ActivityTracker } from '@/app/components/ActivityTracker'
import MonitorTelemetryStrip from '@/app/(dashboard)/_components/MonitorTelemetryStrip'
import OperationalStatusPill from '@/app/(dashboard)/_components/OperationalStatusPill'
import { DesktopWorkspaceBar } from '@/app/components/navigation/DesktopWorkspaceBar'

interface DashboardShellProps {
  children: React.ReactNode
  user: AppUser
  profile?: PlayerMapping | null
  hideAnalytics?: boolean
}

export default function DashboardShell({
  children,
  user,
  profile = null,
  hideAnalytics = false
}: DashboardShellProps) {
  const hosted = getRuntimeProfile() === 'hosted'
  return (
    <ErrorBoundary>
      <DashboardThemeWrapper profile={profile}>
        <RadixTooltipProvider>
          <ActivityTracker />
          <div className="min-h-screen bg-linear-to-br from-(--bg-from) via-(--bg-via) to-(--bg-to)">
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60 focus:bg-(--card-bg) focus:text-primary-wh40k focus:px-4 focus:py-2 focus:rounded-sm focus:border focus:border-accent-wh40k"
            >
              Skip to main content
            </a>
            <NavigationServer
              user={user}
              profile={profile}
              hideAnalytics={hideAnalytics}
            />
            {!hosted && <DesktopWorkspaceBar />}
            <main
              id="main-content"
              className="max-w-[1440px] mx-auto px-4 py-8"
            >
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            {hosted && <MonitorTelemetryStrip />}
            <Footer />
            {hosted && <OperationalStatusPill />}
          </div>
        </RadixTooltipProvider>
      </DashboardThemeWrapper>
    </ErrorBoundary>
  )
}
