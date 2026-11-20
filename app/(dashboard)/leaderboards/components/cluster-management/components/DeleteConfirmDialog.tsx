'use client'

import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import {
  RadixDialog,
  RadixDialogContent,
  RadixDialogHeader,
  RadixDialogTitle,
  RadixDialogDescription,
  RadixDialogFooter
} from '@tacticus/ui-kit/radix-dialog'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

/** The phrase a cluster leader types to disable a guild's syncing. */
export const DISABLE_GUILD_CONFIRM_PHRASE = 'disable this guild'

interface DeleteConfirmDialogProps {
  open: boolean
  guildCode: string | null
  confirmText: string
  onOpenChange: (open: boolean) => void
  onConfirmTextChange: (text: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmDialog({
  open,
  guildCode,
  confirmText,
  onOpenChange,
  onConfirmTextChange,
  onConfirm,
  onCancel
}: DeleteConfirmDialogProps) {
  const guildLabel = formatGuildDisplayLabel(null, guildCode)

  return (
    <RadixDialog open={open} onOpenChange={onOpenChange}>
      <RadixDialogContent className="sm:max-w-md">
        <RadixDialogHeader>
          <RadixDialogTitle className="text-red-400">
            Disable guild syncing
          </RadixDialogTitle>
          <RadixDialogDescription className="text-secondary-wh40k">
            This stops syncing <strong>{guildLabel}</strong>. The guild stays in
            this cluster and its members keep their access. You can switch it
            back on from Edit at any time.
            <br />
            <br />
            To take a guild out of the cluster, its leader uses Leave cluster in
            Guild Settings.
            <br />
            <br />
            To confirm, type exactly:{' '}
            <strong>{DISABLE_GUILD_CONFIRM_PHRASE}</strong>
          </RadixDialogDescription>
        </RadixDialogHeader>

        <div className="py-4">
          <Input
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            placeholder={`Type: ${DISABLE_GUILD_CONFIRM_PHRASE}`}
            className="w-full"
          />
        </div>

        <RadixDialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={confirmText !== DISABLE_GUILD_CONFIRM_PHRASE}
          >
            Disable Guild
          </Button>
        </RadixDialogFooter>
      </RadixDialogContent>
    </RadixDialog>
  )
}
