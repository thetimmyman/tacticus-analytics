export function getHrefWithSeason(
  href: string,
  currentSeason: string | null
): string {
  if (!currentSeason) return href
  if (href === '/') return href
  const separator = href.includes('?') ? '&' : '?'
  return `${href}${separator}season=${currentSeason}`
}
