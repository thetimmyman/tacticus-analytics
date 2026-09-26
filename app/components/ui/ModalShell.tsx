'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import clsx from 'clsx'
import { ScreenReaderOnly } from './ScreenReaderOnly'

interface ModalShellProps {
  children: ReactNode
  /** Defaults to `lg` (`max-w-3xl`). */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** ESC (and optionally backdrop click) calls this; omitted, the consumer renders its own close UI. */
  onClose?: () => void
  /** Backdrop click closes (requires `onClose`). Defaults to true. */
  closeOnBackdropClick?: boolean
  /** Heading id for `aria-labelledby`; otherwise `aria-label` is used. */
  titleId?: string
  descriptionId?: string
  ariaLabel?: string
  closeLabel?: string
  /** Renders a top-right `×` (default when `onClose` is set). */
  showCloseButton?: boolean
  className?: string
  contentClassName?: string
}

const sizeClass = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl'
} as const

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function ModalShell({
  children,
  size = 'lg',
  onClose,
  closeOnBackdropClick = true,
  titleId,
  descriptionId,
  ariaLabel = 'Dialog',
  closeLabel = 'Close dialog',
  showCloseButton,
  className,
  contentClassName
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // Remember the opener to restore focus on unmount (SSR-guarded).
  const previouslyFocused = useMemo<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null
    const active = document.activeElement
    return active instanceof HTMLElement ? active : null
  }, [])

  // Document-level so ESC works even with focus on the backdrop.
  useEffect(() => {
    if (!onClose) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const focusTimer = window.setTimeout(() => {
      const focusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable) {
        focusable.focus()
      } else {
        dialog.focus()
      }
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [previouslyFocused])

  // Focus trap on the dialog's onKeyDown, so it never traps on stale nodes.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter(
      (el) =>
        !el.hasAttribute('disabled') &&
        el.getAttribute('aria-hidden') !== 'true'
    )
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const active = document.activeElement as HTMLElement | null
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else {
      if (active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onClose || !closeOnBackdropClick) return
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const fallbackId = useId()
  const labelledBy = titleId ?? undefined
  const labelledProps = labelledBy
    ? { 'aria-labelledby': labelledBy }
    : { 'aria-label': ariaLabel }

  const renderClose = showCloseButton ?? Boolean(onClose)

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4',
        className
      )}
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-modal-id={fallbackId}
        {...labelledProps}
        aria-describedby={descriptionId}
        className={clsx(
          'card-wh40k w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 relative outline-none',
          sizeClass[size],
          contentClassName
        )}
      >
        {renderClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="absolute top-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              ×
            </span>
            <ScreenReaderOnly>{closeLabel}</ScreenReaderOnly>
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
