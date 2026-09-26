export interface CarouselItem {
  id: string
  title: string
  description: string | null
  image_url: string | null
  link_url: string | null
  link_text: string
  item_type: 'news' | 'promo' | 'announcement' | 'event' | 'seasonal'
  promo_code: string | null
  background_color: string
  text_color: string
  accent_color: string
  is_active: boolean
  priority: number
  starts_at: string | null
  expires_at: string | null
  display_duration_seconds: number
  created_at: string
}

export const DEFAULT_CAROUSEL_ITEM: Partial<CarouselItem> = {
  title: '',
  description: '',
  image_url: '',
  link_url: '',
  link_text: 'Learn More',
  item_type: 'news',
  promo_code: '',
  background_color: '#1a1a2e',
  text_color: '#ffffff',
  accent_color: '#e94560',
  is_active: true,
  priority: 0,
  starts_at: null,
  expires_at: null,
  display_duration_seconds: 8
}

export function getCarouselTimeRemaining(
  expiresAt: string | null,
  now = new Date()
) {
  if (!expiresAt) return null
  const diff = new Date(expiresAt).getTime() - now.getTime()
  if (diff <= 0) return 'Expired'

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (days > 0) return `${days}d ${hours}h remaining`
  if (hours > 0) return `${hours}h ${minutes}m remaining`
  return `${minutes}m remaining`
}
