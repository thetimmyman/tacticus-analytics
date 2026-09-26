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
            Confirm Guild Deletion
          </RadixDialogTitle>
          <RadixDialogDescription className="text-[var(--text-secondary)]">
            This action is PERMANENT and will disable{' '}
            <strong>{guildLabel}</strong> from the entire cluster.
            <br />
            <br />
            To confirm, please type exactly: <strong>delete this guild</strong>
          </RadixDialogDescription>
        </RadixDialogHeader>

        <div className="py-4">
          <Input
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            placeholder="Type: delete this guild"
            className="w-full"
          />
        </div>

        <RadixDialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="text-red-500 border-red-500 hover:bg-red-50"
            onClick={onConfirm}
            disabled={confirmText !== 'delete this guild'}
          >
            Delete Guild
          </Button>
        </RadixDialogFooter>
      </RadixDialogContent>
    </RadixDialog>
  )
}
