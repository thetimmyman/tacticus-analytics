import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import Link from 'next/link'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import type { WorkspaceSection } from './workspaces'

interface WorkspaceSectionMenuLinkProps extends Omit<
  ComponentPropsWithoutRef<'a'>,
  'href'
> {
  currentSeason: string | null
  pathname: string
  section: WorkspaceSection
  variant: 'desktop' | 'mobile'
}

const baseClass =
  'flex min-h-[44px] items-center rounded-md px-3 py-2.5 text-sm transition-colors'

// Used as a Radix menu item's `asChild`: injected props and ref must reach the
// anchor or roving focus and close-on-select break.
export const WorkspaceSectionMenuLink = forwardRef<
  HTMLAnchorElement,
  WorkspaceSectionMenuLinkProps
>(function WorkspaceSectionMenuLink(
  { currentSeason, pathname, section, variant, className, ...rest },
  ref
) {
  const isExternal = section.external || section.href.startsWith('http')
  const href = isExternal
    ? section.href
    : getHrefWithSeason(section.href, currentSeason)
  const matchPath = section.activePrefix ?? section.href
  const isActive =
    pathname === matchPath || pathname.startsWith(`${matchPath}/`)
  const isAdminLink = section.href === '/admin/feature-releases'
  const isDiscord = section.label === 'Discord'
  const spacingClass = variant === 'mobile' ? 'space-x-1.5' : 'gap-2'
  const labelClass =
    variant === 'mobile'
      ? 'text-[11px] font-medium truncate'
      : 'font-medium truncate'
  const mergeClass = (ownClass: string) =>
    className ? `${ownClass} ${className}` : ownClass

  if (isExternal) {
    return (
      <a
        {...rest}
        ref={ref}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${section.label} (opens in a new tab)`}
        className={mergeClass(
          `${baseClass} ${spacingClass} hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] bg-(--card-bg)`
        )}
      >
        {isDiscord && (
          <span aria-hidden="true">
            <DiscordIcon
              className={variant === 'mobile' ? 'h-3 w-3' : 'h-4 w-4'}
            />
          </span>
        )}
        <span className={labelClass}>{section.label}</span>
        <span
          className="ml-auto text-[10px] text-secondary-wh40k"
          aria-hidden="true"
        >
          ↗
        </span>
      </a>
    )
  }

  const stateClass = isActive
    ? isAdminLink
      ? 'bg-linear-to-r from-red-500 to-red-600 text-white'
      : 'bg-linear-to-r from-(--primary) to-(--accent) text-(--bg-primary)'
    : isAdminLink
      ? 'hover:bg-red-500/10 bg-(--card-bg) border border-red-500/30'
      : 'hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] bg-(--card-bg)'

  return (
    <Link
      {...rest}
      ref={ref}
      href={href}
      className={mergeClass(`${baseClass} ${spacingClass} ${stateClass}`)}
    >
      <span className={labelClass}>{section.label}</span>
    </Link>
  )
})
