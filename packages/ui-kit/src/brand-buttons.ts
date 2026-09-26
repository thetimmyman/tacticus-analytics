export type BrandType =
  | 'discord'
  | 'tiktok'
  | 'google'
  | 'youtube'
  | 'reddit'
  | 'twitter'
  | 'facebook'
  | 'instagram'

export const brandColors = {
  discord: {
    primary: '#5865F2',
    hover: '#4752C4',
    text: '#FFFFFF'
  },
  tiktok: {
    primary: '#FF0050',
    hover: '#E6004A',
    text: '#FFFFFF'
  },
  google: {
    primary: '#4285F4',
    hover: '#3367D6',
    text: '#FFFFFF'
  },
  youtube: {
    primary: '#FF0000',
    hover: '#CC0000',
    text: '#FFFFFF'
  },
  reddit: {
    primary: '#FF4500',
    hover: '#E63E00',
    text: '#FFFFFF'
  },
  twitter: {
    primary: '#1DA1F2',
    hover: '#1A91DA',
    text: '#FFFFFF'
  },
  facebook: {
    primary: '#1877F2',
    hover: '#166FE5',
    text: '#FFFFFF'
  },
  instagram: {
    primary: '#E4405F',
    hover: '#D62D20',
    text: '#FFFFFF'
  }
} as const

export function getBrandColors(
  brand: BrandType
): (typeof brandColors)[BrandType] {
  return brandColors[brand]
}

export function generateBrandCSS(brand: BrandType): {
  '--brand-primary': string
  '--brand-hover': string
  '--brand-text': string
} {
  const colors = getBrandColors(brand)
  return {
    '--brand-primary': colors.primary,
    '--brand-hover': colors.hover,
    '--brand-text': colors.text
  }
}
