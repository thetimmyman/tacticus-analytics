'use client'

import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import { ModalShell } from './ModalShell'
import { Spinner } from './Spinner'

export type ConfirmDialogTone = 'default' | 'danger' | 'warning'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Label while `busy`. Defaults to "Working...". */
  busyLabel?: string
  busy?: boolean
  tone?: ConfirmDialogTone
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}

const toneConfirmClass: Record<ConfirmDialogTone, string> = {
  default:
    'bg-accent-wh40k text-black hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)]',
  warning:
    'border border-[color-mix(in_srgb,var(--warning)_60%,transparent)] bg-[color-mix(in_srgb,var(--warning)_80%,transparent)] text-(--bg-primary) hover:bg-(--warning)',
  danger:
    'border border-[color-mix(in_srgb,var(--danger)_60%,transparent)] bg-[color-mix(in_srgb,var(--danger)_80%,transparent)] text-white hover:bg-(--danger)'
}

const toneTitleClass: Record<ConfirmDialogTone, string> = {
  default: 'text-primary-wh40k',
  warning: 'text-(--warning)',
  danger: 'text-(--danger)'
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busyLabel = 'Working...',
  busy = false,
  tone = 'default',
  onCancel,
  onConfirm,
  children
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()

  if (!open) return null

  return (
    <ModalShell
      size="sm"
      titleId={titleId}
      descriptionId={description ? descriptionId : undefined}
      onClose={busy ? undefined : onCancel}
      showCloseButton={false}
    >
      <h3
        id={titleId}
        className={clsx('text-xl font-semibold', toneTitleClass[tone])}
      >
        {title}
      </h3>
      {description && (
        <div
          id={descriptionId}
          className="text-sm text-secondary-wh40k leading-relaxed"
        >
          {description}
        </div>
      )}
      {children}
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-[44px] w-full px-4 py-2 text-sm text-secondary-wh40k hover:text-primary-wh40k transition-colors duration-base disabled:opacity-50 sm:w-auto"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={clsx(
            'inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-base disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto',
            toneConfirmClass[tone]
          )}
        >
          {busy && (
            <Spinner size="sm" label={busyLabel} className="text-current" />
          )}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </ModalShell>
  )
}
