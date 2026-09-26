'use client'

import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'
import { BreadcrumbStructuredData } from '@/app/components/StructuredData'

interface BreadcrumbItem {
  name: string
  href: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  const breadcrumbItems = [{ name: 'Home', href: '/' }, ...items]

  const structuredDataItems = breadcrumbItems.map((item) => ({
    name: item.name,
    url: `https://www.tacticusanalytics.com${item.href}`
  }))

  return (
    <>
      <BreadcrumbStructuredData items={structuredDataItems} />
      <nav
        aria-label="Breadcrumb"
        className={`flex items-center space-x-1 text-sm ${className}`}
      >
        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1

          return (
            <div key={item.href} className="flex items-center">
              {index === 0 ? (
                <Link
                  href={item.href}
                  className="flex items-center text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
                  aria-label="Home"
                >
                  <Home className="w-4 h-4" />
                </Link>
              ) : (
                <>
                  <ChevronRight className="w-4 h-4 mx-2 text-[var(--text-secondary)]" />
                  {isLast ? (
                    <span
                      className="text-[var(--text-primary)] font-medium"
                      aria-current="page"
                    >
                      {item.name}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      className="text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
                    >
                      {item.name}
                    </Link>
                  )}
                </>
              )}
            </div>
          )
        })}
      </nav>
    </>
  )
}
