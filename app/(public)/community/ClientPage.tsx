'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CommunityRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/creators')
  }, [router])

  return (
    <div className="min-h-screen bg-(--bg-primary) flex items-center justify-center">
      <div className="text-center">
        <p className="text-secondary-wh40k">Redirecting to Community...</p>
      </div>
    </div>
  )
}
