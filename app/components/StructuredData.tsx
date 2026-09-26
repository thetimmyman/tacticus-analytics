import { APP_ORIGINS } from '@tacticus/app-core/app-config'

export function StructuredData() {
  const siteUrl = APP_ORIGINS.PRODUCTION
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Tacticus Analytics',
    alternateName: 'Tacticus Guild Raid Tracker',
    url: siteUrl,
    logo: `${siteUrl}/images/logo-no-words.png`,
    description:
      'Professional analytics platform for Warhammer 40,000: Tacticus guild raids. Track token availability, analyze battle performance, and optimize guild strategies.',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '150',
      bestRating: '5',
      worstRating: '1'
    },
    author: {
      '@type': 'Organization',
      name: 'Tacticus Analytics Team',
      url: siteUrl
    },
    publisher: {
      '@type': 'Organization',
      name: 'Tacticus Analytics',
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}/images/logo-no-words.png`
      }
    },
    datePublished: '2024-07-01',
    dateModified: '2025-01-16',
    featureList: [
      'Real-time token and bomb tracking',
      '90+ performance metrics',
      'Meta team analysis with Sharpe ratios',
      'Multi-cluster support',
      'Discord webhook integration',
      'Boss assignment planning',
      'VOTLW tracking',
      'Guild member management',
      'Historical performance data',
      'API key encryption'
    ],
    keywords:
      'Tacticus, guild raids, analytics, token tracker, battle performance, meta analysis',
    inLanguage: 'en-US',
    isAccessibleForFree: true,
    isFamilyFriendly: true,
    potentialAction: {
      '@type': 'ViewAction',
      target: `${siteUrl}/explore`,
      name: 'Explore Guilds'
    }
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  )
}

export function OrganizationStructuredData() {
  const siteUrl = APP_ORIGINS.PRODUCTION
  const orgData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Tacticus Analytics',
    url: siteUrl,
    logo: `${siteUrl}/images/logo-no-words.png`,
    sameAs: ['https://discord.gg/vd9Htx6Xs4'],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: 'English',
      url: `${siteUrl}/faq`
    }
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(orgData) }}
    />
  )
}

export function BreadcrumbStructuredData({
  items
}: {
  items: Array<{ name: string; url: string }>
}) {
  const breadcrumbData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData) }}
    />
  )
}
