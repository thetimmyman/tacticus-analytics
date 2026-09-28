import { requireRole } from '@/app/lib/auth'
import { ErrorMonitoringDashboard } from './ErrorMonitoringDashboard'

export const metadata = {
  title: 'Error Monitoring | Tacticus Analytics',
  description: 'Real-time error tracking and analysis dashboard'
}

export default async function ErrorMonitoringPage() {
  await requireRole('leader')

  return (
    <div className="py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary-wh40k mb-4">
          Error Monitoring Dashboard
        </h1>
        <p className="text-secondary-wh40k text-lg">
          Real-time error tracking, analysis, and version-based insights for
          production debugging.
        </p>
      </div>

      <ErrorMonitoringDashboard />
    </div>
  )
}
