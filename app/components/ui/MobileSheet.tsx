'use client'

/**
 * Bottom sheet on small screens, centred dialog above the breakpoint. Its `[&_button]`
 * min-height rules out-specify children; a child's full-screen modal should portal to
 * `document.body`.
 */

import { X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'

export interface MobileSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  desktopBreakpoint?: 'lg' | 'xl' | 'none'
  outerClassName?: string
  contentClassName?: string
  outerProps?: Record<string, string | undefined>
}

export function MobileSheet({
  isOpen,
  onClose,
  title,
  children,
  desktopBreakpoint = 'lg',
  outerClassName = '',
  contentClassName = '',
  outerProps
}: MobileSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    dialogRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [isOpen])

  if (!isOpen) return null

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    )
    if (focusable.length === 0) {
      event.preventDefault()
      event.currentTarget.focus()
      return
    }

    const first = focusable[0]
    const last = focusable.at(-1)
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === event.currentTarget)
    ) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const breakpointClass =
    desktopBreakpoint === 'none'
      ? ''
      : desktopBreakpoint === 'xl'
        ? 'xl:hidden'
        : 'lg:hidden'

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end xl:items-center xl:justify-center xl:p-6 ${outerClassName} ${breakpointClass}`}
      {...outerProps}
    >
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label={`Close ${title.toLowerCase()}`}
        tabIndex={-1}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className={`relative w-full max-h-[85vh] bg-(--bg-secondary) border border-(--card-border) rounded-t-2xl xl:max-w-2xl xl:rounded-2xl p-4 overflow-y-auto [&_button]:min-h-[44px] [&_button]:min-w-[44px] [&_input]:min-h-[44px] [&_select]:min-h-[44px] [&_textarea]:min-h-[44px] ${contentClassName}`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary-wh40k">
            {title}
          </div>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] p-2 rounded-full bg-(--card-bg) text-primary-wh40k"
            aria-label={`Close ${title.toLowerCase()}`}
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
