import type { ReactNode } from 'react'
import { LineupsSubnav } from './_components/LineupsSubnav'

export default function LineupsLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <LineupsSubnav />
      {children}
    </div>
  )
}
