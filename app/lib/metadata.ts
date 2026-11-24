import type { Metadata } from 'next'

const SITE_NAME = 'Tacticus Analytics'

interface PageMetadataOptions {
  title: string
  description: string
  path?: `/${string}`
  // Absolute-or-site-root og image; keeps the card when a page overrides
  // the root layout's openGraph/twitter objects wholesale.
  image?: string
}

export function createPageMetadata({
  title,
  description,
  path,
  image
}: PageMetadataOptions): Metadata {
  const fullTitle = title.includes(SITE_NAME)
    ? title
    : `${title} | ${SITE_NAME}`

  return {
    title: fullTitle,
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    openGraph: {
      title: fullTitle,
      description,
      siteName: SITE_NAME,
      type: 'website',
      ...(path ? { url: path } : {}),
      ...(image ? { images: [image] } : {})
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      ...(image ? { images: [image] } : {})
    }
  }
}
