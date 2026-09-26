import type { ReactNode } from 'react'

import { createPageMetadata } from '@/app/lib/metadata'
import WarLayoutClient from '../_components/WarLayoutClient'

type WarLayoutProps = {
  children: ReactNode
  params: Promise<{ warId: string }>
}

export const metadata = createPageMetadata({
  title: 'War Detail',
  description:
    'Review one guild war with board state, guild and opponent lineups, zone scores, failed attacks, and perfect clears.'
})

export default async function WarLayout({ children, params }: WarLayoutProps) {
  const { warId } = await params
  return <WarLayoutClient warId={warId}>{children}</WarLayoutClient>
}
