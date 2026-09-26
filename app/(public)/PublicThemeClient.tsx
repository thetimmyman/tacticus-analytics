'use client'

import type { ReactNode } from 'react'
import type { UserProfile } from '@/app/lib/auth'
import { ThemeProvider } from '@/app/components/ThemeProvider'
import { PublicThemeProvider } from '@/app/components/PublicThemeProvider'

interface PublicThemeClientProps {
  children: ReactNode
  profile?: UserProfile | null
}

export default function PublicThemeClient({
  children,
  profile
}: PublicThemeClientProps) {
  if (profile) {
    return <ThemeProvider profile={profile}>{children}</ThemeProvider>
  }

  return <PublicThemeProvider>{children}</PublicThemeProvider>
}
