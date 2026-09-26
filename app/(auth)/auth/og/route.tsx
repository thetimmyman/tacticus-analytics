import { brandedOgImage } from '@/app/lib/og/branded-og'

export const dynamic = 'force-dynamic'

export async function GET() {
  return brandedOgImage({
    title: 'Access Your Guild',
    description:
      "Sign in to access your guild's performance analytics and raid insights",
    badges: ['🔐 Secure Access', '📊 Guild Analytics', '⚡ Real-time Data'],
    watermark: 'www.tacticusanalytics.com/auth'
  })
}
