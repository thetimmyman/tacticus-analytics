'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

type Access = {
  demo?: boolean
  playerReady?: boolean
  guildReady?: boolean
  tokens?: number | null
  bombs?: number | null
  updatedAt?: string | null
}

export default function DesktopAccessGate({
  children
}: {
  children: ReactNode
}) {
  const pathname = usePathname()
  const [access, setAccess] = useState<Access | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/desktop/onboarding-status', {
      cache: 'no-store',
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Access status unavailable')
        return response.json()
      })
      .then(setAccess)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [])
  const controls = pathname === '/profile' || pathname.startsWith('/profile/')
  const savedContent =
    pathname === '/guild-teams' ||
    pathname === '/roster' ||
    pathname === '/token-usage' ||
    pathname === '/boss-assignments/targets' ||
    pathname === '/boss-assignments/season' ||
    pathname === '/boss-assignments/current'
  const personal =
    pathname === '/roster' ||
    pathname === '/achievements' ||
    pathname === '/meta-atlas'
  if (controls || savedContent || access?.demo) return children
  if (!access)
    return (
      <div role="status">
        {failed
          ? 'Workspace access status is unavailable. Reopen the app to retry.'
          : 'Checking workspace API access…'}
      </div>
    )
  if (!access.playerReady || (!personal && !access.guildReady)) {
    return (
      <div className="card-wh40k p-8">
        <h1 className="text-2xl font-semibold">
          {access.playerReady
            ? 'Add Guild and Guild Raid access'
            : 'Connect your Player API key'}
        </h1>
        <p className="my-4">
          {access.playerReady
            ? 'Your personal content is ready. Guild features unlock after both Guild and Guild Raid access are verified.'
            : 'Player access is required to load your roster and personal token/bomb information. Your existing local data is preserved.'}
        </p>
        <a href="/desktop/connect" className="underline">
          Set up API access
        </a>
      </div>
    )
  }
  return (
    <>
      <div className="mb-4 text-sm" role="status">
        Saved raid tokens: {access.tokens ?? 'unavailable'} · Saved bombs:{' '}
        {access.bombs ?? 'unavailable'}
        {access.updatedAt && (
          <> · Upstream updated {new Date(access.updatedAt).toISOString()}</>
        )}
        {' · '}
        <a href="/desktop/connect" className="underline">
          Manage API access and sync
        </a>
      </div>
      {children}
    </>
  )
}
