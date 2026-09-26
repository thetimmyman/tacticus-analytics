import { Calendar, Megaphone, Snowflake, Tag } from 'lucide-react'

export const CAROUSEL_ITEM_TYPES = [
  {
    key: 'news',
    label: 'News',
    icon: <Megaphone className="h-4 w-4" />,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10'
  },
  {
    key: 'promo',
    label: 'Promo Code',
    icon: <Tag className="h-4 w-4" />,
    color: 'text-green-400',
    bg: 'bg-green-500/10'
  },
  {
    key: 'announcement',
    label: 'Announcement',
    icon: <Megaphone className="h-4 w-4" />,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10'
  },
  {
    key: 'event',
    label: 'Event',
    icon: <Calendar className="h-4 w-4" />,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10'
  },
  {
    key: 'seasonal',
    label: 'Seasonal/Winter',
    icon: <Snowflake className="h-4 w-4" />,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10'
  }
] as const

export function getCarouselTypeConfig(type: string) {
  return (
    CAROUSEL_ITEM_TYPES.find((candidate) => candidate.key === type) ??
    CAROUSEL_ITEM_TYPES[0]
  )
}
