import { memo } from 'react'
import { getMetaTeamColorClasses } from '@/app/lib/meta/meta-team-styling'

interface MultipleCategoryBadgesProps {
  categories: string[]
  className?: string
}

export const getCategoryColor = (category: string): string =>
  getMetaTeamColorClasses(category, false)

const MultipleCategoryBadges = memo(function MultipleCategoryBadges({
  categories,
  className = ''
}: MultipleCategoryBadgesProps) {
  const firstCategory = categories[0]
  if (
    !categories ||
    categories.length === 0 ||
    (categories.length === 1 && firstCategory === 'Other')
  ) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor('Other')} ${className}`}
      >
        Other
      </span>
    )
  }

  if (categories.length === 1) {
    const category = firstCategory ?? 'Other'
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(category)} ${className}`}
      >
        {category}
      </span>
    )
  }

  return (
    <div className={`flex flex-wrap gap-1 items-center ${className}`}>
      {categories.map((category) => (
        <span
          key={category}
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${getCategoryColor(category)} flex-shrink-0`}
        >
          {category}
        </span>
      ))}
    </div>
  )
})

export default MultipleCategoryBadges
