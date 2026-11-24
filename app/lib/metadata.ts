import type { Metadata } from 'next'

const SITE_NAME = 'Tacticus Analytics'

export interface PageOgImage {
  url: string
  width?: number
  height?: number
  alt?: string
}

export const DEFAULT_OG_IMAGE: PageOgImage = {
  url: '/WarpForgedDashboard.png',
  width: 1536,
  height: 1024,
  alt: SITE_NAME
}

interface PageMetadataOptions {
  title: string
  description: string
  path?: `/${string}`
  // Absolute-or-site-root og image; keeps the card when a page overrides
  // the root layout's openGraph/twitter objects wholesale.
  image?: string | PageOgImage
}

export function createPageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE
}: PageMetadataOptions): Metadata {
  const fullTitle = title.includes(SITE_NAME)
    ? title
    : `${title} | ${SITE_NAME}`
  const twitterImage = typeof image === 'string' ? image : image.url

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
      images: [image]
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [twitterImage]
    }
  }
}
