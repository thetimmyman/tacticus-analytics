import { brandedOgImage } from '@/app/lib/og/branded-og'

export const dynamic = 'force-dynamic'

export async function GET() {
  return brandedOgImage({
    title: 'Explore Guilds',
    description:
      'Compare public guild raid snapshots, boss damage, and cluster rankings.',
    badges: ['Guild Rankings', 'Performance Stats', 'Achievements'],
    watermark: 'www.tacticusanalytics.com/explore'
  })
}
