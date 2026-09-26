'use client'

import { PublicThemeProvider } from '@/app/components/PublicThemeProvider'

export default function AuthThemeWrapper({
  children
}: {
  children: React.ReactNode
}) {
  return <PublicThemeProvider>{children}</PublicThemeProvider>
}
