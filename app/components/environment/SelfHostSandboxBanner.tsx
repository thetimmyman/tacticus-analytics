'use client'

import { AlertTriangle } from 'lucide-react'

export default function SelfHostSandboxBanner() {
  const isSandboxMode = process.env.NEXT_PUBLIC_SELFHOST_SANDBOX_MODE === 'true'

  if (!isSandboxMode) {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white text-center py-2 px-4 text-sm font-bold shadow-lg">
      <div className="flex items-center justify-center gap-2">
        <AlertTriangle className="h-4 w-4 animate-pulse" />
        <span>SANDBOX MODE - DATA NOT SAVED TO PRODUCTION</span>
        <AlertTriangle className="h-4 w-4 animate-pulse" />
      </div>
      <div className="text-xs font-normal opacity-80 mt-1">
        This is a local development environment. Any changes will not persist.
      </div>
    </div>
  )
}
