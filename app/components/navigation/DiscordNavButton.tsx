'use client'

import { DiscordButton } from '@tacticus/ui-kit/BrandButton'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import { cn } from '@/app/lib/utils/cn'
import { DISCORD_INVITE_URL } from './config'

interface DiscordNavButtonProps {
  className?: string
}

export function DiscordNavButton({ className }: DiscordNavButtonProps) {
  return (
    <DiscordButton
      as="a"
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      showIcon={false}
      size="sm"
      aria-label="Join our Discord server"
      className={cn(
        'h-11 w-11 p-0 rounded-md text-xs transition-all duration-200 leading-none gap-0',
        className
      )}
    >
      <DiscordIcon className="w-4 h-4 shrink-0" />
    </DiscordButton>
  )
}
