'use client'

import Link from 'next/link'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'

/** Shared chrome navigation stays explicit in the local workspace. */
export const ChromeLink = forwardRef<
  HTMLAnchorElement,
  ComponentPropsWithoutRef<typeof Link>
>(function ChromeLink({ prefetch, ...props }, ref) {
  return (
    <Link
      {...props}
      ref={ref}
      prefetch={getRuntimeProfile() === 'desktop' ? false : prefetch}
    />
  )
})
