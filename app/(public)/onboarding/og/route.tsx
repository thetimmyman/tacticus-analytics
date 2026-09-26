import { brandedOgImage } from '@/app/lib/og/branded-og'

export const dynamic = 'force-dynamic'

export async function GET() {
  return brandedOgImage({
    title: 'Join Your Guild',
    description:
      'Get started with guild raid analytics - create account or join existing guild',
    badges: ['Join Guild', 'Setup Analytics', 'Start Tracking'],
    watermark: 'www.tacticusanalytics.com/onboarding'
  })
}
