import { brandedOgImage } from '@/app/lib/og/branded-og'

export const dynamic = 'force-dynamic'

export async function GET() {
  return brandedOgImage({
    title: 'FAQ',
    description: 'Get answers to common questions about guild raid analytics',
    badges: ['Token Tracking', 'Performance Metrics', 'API Setup'],
    watermark: 'www.tacticusanalytics.com/faq'
  })
}
