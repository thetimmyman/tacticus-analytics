'use client'

/** Collapsed note preview plus a full-screen editor that commits on Apply. */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import clsx from 'clsx'
import { BookOpen, Check, Loader2, PencilLine, X } from 'lucide-react'

export function NotesInput({
  label,
  value,
  disabled,
  placeholder,
  onChange
}: {
  label: string
  value: string
  disabled: boolean
  placeholder: string
  onChange: (value: string) => void | Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  // Portal to body: inside MobileSheet it would inherit the focus trap, Escape and
  // min-height rules. `mounted` keeps createPortal off the server.
  const mounted = useHasMounted()
  const trimmed = value.trim()
  const lineCount = trimmed ? value.split(/\r\n|\r|\n/).length : 0

  const openEditor = () => {
    setDraft(value)
    setSaveError(false)
    setIsOpen(true)
  }

  const closeEditor = () => {
    if (saving) return
    setIsOpen(false)
  }

  // Apply persists immediately; the modal stays open until the write confirms.
  const applyDraft = async () => {
    if (disabled || saving) return
    setSaving(true)
    setSaveError(false)
    try {
      await onChange(draft)
      setSaving(false)
      setIsOpen(false)
    } catch {
      setSaving(false)
      setSaveError(true)
    }
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
        {label}
      </div>
      <div className="rounded-md border border-(--card-border) bg-black/20">
        <div className="flex items-start gap-2 p-2">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[color-mix(in_srgb,var(--accent)_85%,transparent)]" />
          <div className="min-w-0 flex-1">
            <div
              className={clsx(
                'text-xs leading-5',
                trimmed ? 'text-primary-wh40k' : 'italic text-(--text-tertiary)'
              )}
            >
              {trimmed ? (
                <span className="block max-h-15 overflow-hidden whitespace-pre-wrap">
                  {value}
                </span>
              ) : (
                'No notes configured.'
              )}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-(--text-tertiary)">
              {trimmed
                ? `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} / ${value.length} chars`
                : 'Optional tactics narrative'}
            </div>
          </div>
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-(--card-border) bg-(--bg-secondary) px-2 text-xs font-semibold text-secondary-wh40k hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] hover:text-(--accent)"
          >
            <PencilLine className="h-3.5 w-3.5" />
            {disabled ? 'View' : trimmed ? 'Edit' : 'Add'}
          </button>
        </div>
      </div>

      {isOpen &&
        mounted &&
        createPortal(
          <div
            // Above the parent sheet (z-[85]).
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            aria-label={`${label} editor`}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              // React events bubble through portals; stop Escape closing the ancestor sheet.
              event.stopPropagation()
              closeEditor()
            }}
          >
            <div className="w-full max-w-3xl rounded-lg border border-(--card-border) bg-[#171a1f] shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-(--card-border) bg-[#1b1f25] px-4 py-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-(--accent)">
                    Tactics narrative
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-primary-wh40k">
                    {label}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-(--card-border) bg-black/20 text-secondary-wh40k hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] hover:text-primary-wh40k"
                  aria-label="Close notes editor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2 bg-[#171a1f] px-4 py-4">
                <textarea
                  autoFocus
                  value={draft}
                  rows={18}
                  readOnly={disabled || saving}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={placeholder}
                  className="max-h-[70vh] min-h-[50vh] w-full resize-y rounded-md border border-(--card-border) bg-[#0f1115] px-3 py-3 text-sm leading-6 text-primary-wh40k placeholder-[color-mix(in_srgb,var(--text-secondary)_55%,transparent)] focus:border-[color-mix(in_srgb,var(--accent)_70%,transparent)] focus:outline-hidden read-only:cursor-default"
                />
                <div className="text-xs text-(--text-tertiary)">
                  {draft.trim()
                    ? `${draft.split(/\r\n|\r|\n/).length} lines / ${draft.length} chars`
                    : 'No notes yet.'}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--card-border) bg-[#1b1f25] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setDraft('')}
                  disabled={disabled || saving}
                  className="inline-flex h-9 items-center rounded-md border border-(--card-border) bg-black/15 px-3 text-sm font-semibold text-secondary-wh40k hover:text-primary-wh40k disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
                <div className="flex items-center gap-2">
                  {saveError && (
                    <span className="text-xs font-semibold text-red-400">
                      Save failed — try again
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={closeEditor}
                    disabled={saving}
                    className="inline-flex h-9 items-center rounded-md border border-(--card-border) bg-black/15 px-3 text-sm font-semibold text-secondary-wh40k hover:text-primary-wh40k disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {disabled ? 'Close' : 'Cancel'}
                  </button>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => void applyDraft()}
                      disabled={saving}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-3 text-sm font-semibold text-(--accent) hover:bg-[color-mix(in_srgb,var(--accent)_25%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      {saving ? 'Saving…' : 'Apply notes'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
