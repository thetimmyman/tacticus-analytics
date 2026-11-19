'use client'

import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import { OctagonAlert, TriangleAlert } from 'lucide-react'
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

/**
 * Confirm button per tone: an opaque fill, the label the theme computed for
 * that fill, and a visible hover step that keeps the label readable (see
 * docs/decisions/0003-on-fill-label-tokens.md). A translucent tint let the
 * card behind it change the contrast, and hover made it worse.
 */
const toneConfirmClass: Record<ConfirmDialogTone, string> = {
  default: 'bg-(--accent) text-(--on-accent) hover:bg-(--accent-fill-hover)',
  warning: 'bg-(--warning) text-(--on-warning) hover:bg-(--warning-fill-hover)',
  danger: 'bg-(--danger) text-(--on-danger) hover:bg-(--danger-fill-hover)'
}

/**
 * Warning and danger carry a round badge before the title: the status fill with
 * its computed label, so the tone is not a colour in the title text alone.
 */
const toneBadge = {
  warning: {
    Icon: TriangleAlert,
    className: 'bg-(--warning) text-(--on-warning)'
  },
  danger: {
    Icon: OctagonAlert,
    className: 'bg-(--danger) text-(--on-danger)'
  }
} as const

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
  const badge = tone === 'default' ? null : toneBadge[tone]

  if (!open) return null

  return (
    <ModalShell
      size="sm"
      titleId={titleId}
      descriptionId={description ? descriptionId : undefined}
      onClose={busy ? undefined : onCancel}
      showCloseButton={false}
    >
      <div className="flex items-start gap-3">
        {badge && (
          <span
            aria-hidden="true"
            className={clsx(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent',
              badge.className
            )}
          >
            <badge.Icon className="h-4 w-4" />
          </span>
        )}
        <h3
          id={titleId}
          className="min-w-0 text-xl leading-8 font-bold text-primary-wh40k"
        >
          {title}
        </h3>
      </div>
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
            'inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-transparent px-4 py-2 text-sm font-semibold transition-colors duration-base disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto',
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
