import { ThemeProvider } from '@/app/components/ThemeProvider'
import type { PlayerMapping } from '@tacticus/app-core/types'

interface DashboardThemeWrapperProps {
  children: React.ReactNode
  profile?: PlayerMapping | null
}

export default function DashboardThemeWrapper({
  children,
  profile
}: DashboardThemeWrapperProps) {
  return <ThemeProvider profile={profile}>{children}</ThemeProvider>
}
