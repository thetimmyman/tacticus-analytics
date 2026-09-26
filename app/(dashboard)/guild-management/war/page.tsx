import { redirect } from 'next/navigation'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Guild War Management',
  description:
    'Legacy guild war management route that forwards officers to the War Reports workspace.'
})

export default function GuildWarPage() {
  redirect('/wars')
}
