import type { Metadata } from 'next'

const SITE_NAME = 'Tacticus Analytics'

interface PageMetadataOptions {
  title: string
  description: string
  path?: `/${string}`
}

export function createPageMetadata({
  title,
  description,
  path
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
      ...(path ? { url: path } : {})
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description
    }
  }
}
