import { Button } from '@tacticus/ui-kit'
import {
  RadixDropdownMenu,
  RadixDropdownMenuContent,
  RadixDropdownMenuItem,
  RadixDropdownMenuSeparator,
  RadixDropdownMenuTrigger
} from '@tacticus/ui-kit/radix-dropdown'
import { MessageSquare, MoreVertical, Settings, Trash2 } from 'lucide-react'

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
              ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] min-w-[44px] min-h-[44px] p-2 ml-2 flex-shrink-0'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] group relative min-w-[36px] min-h-[36px]'
          }
          aria-label="Guild actions menu"
        >
          <MoreVertical className={mobile ? 'w-5 h-5' : 'w-4 h-4'} />
          {!mobile && (
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
              Actions
            </span>
          )}
        </Button>
      </RadixDropdownMenuTrigger>
      <RadixDropdownMenuContent align="end" className="w-52 z-50">
        <RadixDropdownMenuItem
          onClick={onEdit}
          className="flex items-center gap-2 cursor-pointer p-3 hover:bg-[var(--bg-secondary)]"
        >
          <Settings className="w-4 h-4" />
          Edit Configuration
        </RadixDropdownMenuItem>
        <RadixDropdownMenuItem
          onClick={onToggleWebhooks}
          className="flex items-center gap-2 cursor-pointer p-3 hover:bg-[var(--bg-secondary)]"
        >
          <MessageSquare className="w-4 h-4" />
          {isWebhooksExpanded ? 'Hide' : 'Manage'} Webhooks
        </RadixDropdownMenuItem>
        <RadixDropdownMenuSeparator />
        <RadixDropdownMenuItem
          onClick={onDelete}
          className="flex items-center gap-2 cursor-pointer p-3 hover:bg-red-900/20 text-red-500"
        >
          <Trash2 className="w-4 h-4" />
          Disable Guild
        </RadixDropdownMenuItem>
      </RadixDropdownMenuContent>
    </RadixDropdownMenu>
  )
}
