'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  BarChart3,
  Users,
  TrendingUp,
  Target,
  Trophy,
  Zap,
  Camera,
  Check,
  ChevronRight,
  MessageSquare
} from 'lucide-react'

const features = [
  {
    icon: <TrendingUp className="w-6 h-6" />,
    title: 'Performance Analytics',
    description:
      'Track boss damage, token use, player rankings, and cluster comparisons from synced raid data',
    details: [
      'Real-time damage tracking',
      'Token efficiency analysis',
      'Historical performance trends',
      'Cluster-wide comparisons'
    ],
    images: ['/screenshots/metrics.png'],
    primaryImage: '/screenshots/metrics.png'
  },
  {
    icon: <Zap className="w-6 h-6" />,
    title: 'Token Availability Tracking',
    description:
      'Current tokens, bomb timers, caps, and season usage from player API keys',
    details: [
      '3 token maximum capacity',
      '1 token every 12 hours regeneration',
      '18 hour bomb cooldown timer',
      'Season-wide usage tracking (28-29 tokens)'
    ],
    images: ['/screenshots/token-tracking.png'],
    primaryImage: '/screenshots/token-tracking.png'
  },
  {
    icon: <Target className="w-6 h-6" />,
    title: 'Real-Time Battle Tracking',
    description:
      'Sync boss damage and battle logs from the Tacticus API during active raid seasons',
    details: [
      'Live boss damage tracking',
      'Battle history logs',
      'Sweep detection'
    ],
    images: ['/screenshots/battle-log.png'],
    primaryImage: '/screenshots/battle-log.png'
  },
  {
    icon: <BarChart3 className="w-6 h-6" />,
    title: 'Meta Team Analysis',
    description:
      'Compare recorded team compositions by boss, rarity, damage, and stability',
    details: [
      'Top performing team compositions',
      'Sharpe ratio optimization (90% damage, 10% stability)',
      'Boss-specific recommendations',
      'Team category badges (Custodes, Admech, Double Howl, etc.)'
    ],
    images: ['/screenshots/meta-analysis.png'],
    primaryImage: '/screenshots/meta-analysis.png'
  },
  {
    icon: <Target className="w-6 h-6" />,
    title: 'Boss Assignment Planning',
    description:
      'Plan boss targets from token capacity, historical damage, and remaining boss HP',
    details: [
      'Token Distribution System',
      'Historical performance-based recommendations',
      'Capacity planning with boss HP calculations',
      'Officer-reviewed assignment queues'
    ],
    images: ['/screenshots/assignments.png'],
    primaryImage: '/screenshots/assignments.png'
  },
  {
    icon: <MessageSquare className="w-6 h-6" />,
    title: 'Discord Webhook Integration',
    description:
      'Post leaderboards, boss kills, and season summaries to configured Discord channels',
    details: [
      'Hourly leaderboard updates',
      'Boss Kill Notifications',
      'Team composition sharing'
    ],
    images: ['/screenshots/discord.png'],
    primaryImage: '/screenshots/discord.png'
  },
  {
    icon: <Users className="w-6 h-6" />,
    title: 'Guild Management',
    description:
      'Officer tools for member data, permissions, API keys, and guild settings',
    details: [
      'Member performance tracking',
      'Role-based permissions (Member/Officer/Leader)',
      'API key management',
      'Guild settings configuration'
    ],
    images: ['/screenshots/guild-management.png'],
    primaryImage: '/screenshots/guild-management.png'
  },
  {
    icon: <Trophy className="w-6 h-6" />,
    title: 'Cluster Support',
    description:
      'Manage independent guilds in a cluster with shared leaderboards and access boundaries',
    details: [
      'Independent guilds support',
      'Cluster-wide analytics',
      'Cross-guild comparisons'
    ],
    images: ['/screenshots/clusters.png'],
    primaryImage: '/screenshots/clusters.png'
  }
]

export function FeatureHighlightsWithImages() {
  const [activeFeature, setActiveFeature] = useState(0)
  const [activeImage, setActiveImage] = useState(0)

  const currentFeature = features[activeFeature] ?? features[0]
  if (!currentFeature) {
    return null
  }
  const displayImage =
    currentFeature.images[activeImage] || currentFeature.primaryImage

  return (
    <div className="py-16 bg-linear-to-b from-(--bg-from) via-gray-900 to-(--bg-to)">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-primary-wh40k mb-4">
            Guild Raid Tools in Production
          </h2>
          <p className="text-xl text-secondary-wh40k max-w-3xl mx-auto">
            Live API sync, token availability, boss damage, Discord webhooks,
            and cluster views for active guilds
          </p>
        </div>

        {/* Main Content - Desktop Layout */}
        <div className="hidden lg:grid lg:grid-cols-2 lg:gap-12 items-start">
          {/* Left: Feature List */}
          <div className="space-y-4">
            {features.map((feature, featureIndex) => (
              <div
                key={feature.title}
                onClick={() => {
                  setActiveFeature(featureIndex)
                  setActiveImage(0)
                }}
                className={`cursor-pointer rounded-lg p-4 transition-all ${
                  activeFeature === featureIndex
                    ? 'bg-linear-to-r from-red-900/30 to-transparent border-l-4 border-red-500'
                    : 'hover:bg-white/5'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      activeFeature === featureIndex
                        ? 'bg-red-500/20 text-red-500'
                        : 'bg-(--card-bg) text-secondary-wh40k'
                    }`}
                  >
                    {feature.icon}
                  </div>
                  <div className="flex-1">
                    <h3
                      className={`font-bold mb-1 ${
                        activeFeature === featureIndex
                          ? 'text-primary-wh40k'
                          : 'text-secondary-wh40k'
                      }`}
                    >
                      {feature.title}
                    </h3>
                    <p
                      className={`text-sm mb-2 ${
                        activeFeature === featureIndex
                          ? 'text-secondary-wh40k'
                          : 'text-secondary-wh40k'
                      }`}
                    >
                      {feature.description}
                    </p>
                    {activeFeature === featureIndex && (
                      <ul className="space-y-1 mt-3">
                        {feature.details.map((detail) => (
                          <li
                            key={detail}
                            className="flex items-center gap-2 text-sm text-secondary-wh40k"
                          >
                            <ChevronRight className="w-3 h-3 text-red-500" />
                            {detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Image Display */}
          <div className="sticky top-4">
            <div className="relative aspect-video bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 rounded-lg overflow-hidden shadow-2xl border border-(--card-border)">
              {displayImage.startsWith('/screenshots/') ? (
                <div className="w-full h-full bg-linear-to-br from-(--bg-from) to-(--bg-to) flex items-center justify-center p-8">
                  <div className="text-center">
                    <div className="text-6xl mb-4 flex justify-center text-red-500/50">
                      {currentFeature.icon}
                    </div>
                    <h3 className="text-xl font-bold text-primary-wh40k mb-2">
                      {currentFeature.title}
                    </h3>
                    <p className="text-secondary-wh40k text-sm max-w-sm mx-auto mb-4">
                      {currentFeature.description}
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {currentFeature.details.slice(0, 3).map((detail) => (
                        <span
                          key={detail}
                          className="text-xs px-3 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-red-400"
                        >
                          <Check className="mr-1 inline h-3 w-3 align-[-2px]" />
                          {(detail.split('(')[0] ?? detail).trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <Image
                  src={displayImage}
                  alt={currentFeature.title}
                  fill
                  className="object-contain"
                  priority
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              )}
            </div>

            {/* Image Thumbnails */}
            {currentFeature.images.length > 1 && (
              <div className="flex gap-2 mt-4">
                {currentFeature.images.map((img, imgIndex) => (
                  <button
                    key={img}
                    onClick={() => setActiveImage(imgIndex)}
                    className={`relative h-16 flex-1 rounded overflow-hidden border-2 transition-all ${
                      activeImage === imgIndex
                        ? 'border-red-500'
                        : 'border-(--card-border) opacity-60 hover:opacity-100'
                    }`}
                  >
                    {img.startsWith('/screenshots/') ? (
                      <div className="w-full h-full bg-linear-to-br from-(--bg-from) to-(--bg-to) flex items-center justify-center">
                        <span className="text-xs text-secondary-wh40k">
                          Preview {imgIndex + 1}
                        </span>
                      </div>
                    ) : (
                      <Image
                        src={img}
                        alt={`Screenshot ${imgIndex + 1}`}
                        fill
                        className="object-cover"
                        sizes="100px"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mobile Layout - Simplified without screenshots */}
        <div className="lg:hidden space-y-3 sm:space-y-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-(--card-bg) rounded-lg border border-(--card-border) overflow-hidden"
            >
              {/* Header with Icon - No screenshots on mobile */}
              <div className="bg-linear-to-r from-(--bg-from) to-(--bg-to) p-3 sm:p-4">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="p-2 sm:p-3 rounded-lg bg-red-500/20 text-red-500">
                    {feature.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-primary-wh40k text-base sm:text-lg">
                      {feature.title}
                    </h3>
                    <p className="text-secondary-wh40k text-xs sm:text-sm mt-0.5 sm:mt-1 line-clamp-2">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Feature Details */}
              <div className="p-3 sm:p-4">
                <ul className="space-y-2">
                  {feature.details.map((detail) => (
                    <li key={detail} className="flex items-start gap-2 text-sm">
                      <ChevronRight className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <span className="text-secondary-wh40k">{detail}</span>
                    </li>
                  ))}
                </ul>

                {/* Optional: a "View Screenshots" link */}
                {(() => {
                  const firstImage = feature.images[0]
                  if (!firstImage || firstImage.startsWith('/screenshots/')) {
                    return null
                  }
                  return (
                    <button className="mt-4 text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1">
                      <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {feature.images.length} screenshots available on desktop
                      </span>
                    </button>
                  )
                })()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
