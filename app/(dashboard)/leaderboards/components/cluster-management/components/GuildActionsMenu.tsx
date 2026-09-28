import { Button } from '@tacticus/ui-kit'
import {
  RadixDropdownMenu,
  RadixDropdownMenuContent,
  RadixDropdownMenuItem,
  RadixDropdownMenuSeparator,
  RadixDropdownMenuTrigger
} from '@tacticus/ui-kit/radix-dropdown'
import { MessageSquare, MoreVertical, Settings, Trash } from 'lucide-react'

interface GuildActionsMenuProps {
  isWebhooksExpanded: boolean
  mobile?: boolean
  onDelete: () => void
  onEdit: () => void
  onToggleWebhooks: () => void
}

export function GuildActionsMenu({
  isWebhooksExpanded,
  mobile = false,
  onDelete,
  onEdit,
  onToggleWebhooks
}: GuildActionsMenuProps) {
  return (
    <RadixDropdownMenu>
      <RadixDropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={
            mobile
              ? 'text-secondary-wh40k hover:text-primary-wh40k min-w-[44px] min-h-[44px] p-2 ml-2 shrink-0'
              : 'text-secondary-wh40k hover:text-primary-wh40k group relative min-w-[36px] min-h-[36px]'
          }
          aria-label="Guild actions menu"
        >
          <MoreVertical className={mobile ? 'w-5 h-5' : 'w-4 h-4'} />
          {!mobile && (
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-(--bg-primary) text-primary-wh40k text-xs px-2 py-1 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
              Actions
            </span>
          )}
        </Button>
      </RadixDropdownMenuTrigger>
      <RadixDropdownMenuContent align="end" className="w-52 z-50">
        <RadixDropdownMenuItem
          onClick={onEdit}
          className="flex items-center gap-2 cursor-pointer p-3 hover:bg-(--bg-secondary)"
        >
          <Settings className="w-4 h-4" />
          Edit Configuration
        </RadixDropdownMenuItem>
        <RadixDropdownMenuItem
          onClick={onToggleWebhooks}
          className="flex items-center gap-2 cursor-pointer p-3 hover:bg-(--bg-secondary)"
        >
          <MessageSquare className="w-4 h-4" />
          {isWebhooksExpanded ? 'Hide' : 'Manage'} Webhooks
        </RadixDropdownMenuItem>
        <RadixDropdownMenuSeparator />
        <RadixDropdownMenuItem
          onClick={onDelete}
          className="flex items-center gap-2 cursor-pointer p-3 hover:bg-red-900/20 text-red-500"
        >
          <Trash className="w-4 h-4" />
          Disable Guild
        </RadixDropdownMenuItem>
      </RadixDropdownMenuContent>
    </RadixDropdownMenu>
  )
}
