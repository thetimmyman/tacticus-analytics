'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import clsx from 'clsx'
import {
  RadixTabs,
  RadixTabsContent,
  RadixTabsList,
  RadixTabsTrigger
} from '@tacticus/ui-kit/radix-tabs'

type Tab = 'preview' | 'edit'

interface TabbedNotesEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  caption?: string
  /** Defaults to `preview` when value is non-empty, else `edit`. */
  defaultTab?: Tab
  rows?: number
  className?: string
  disabled?: boolean
  ariaLabelledBy?: string
  ariaDescribedBy?: string
}

export function TabbedNotesEditor({
  value,
  onChange,
  placeholder = 'Add notes shown in the ping message…',
  caption = 'Sent in ping message · markdown supported',
  defaultTab,
  rows = 4,
  className,
  disabled = false,
  ariaLabelledBy,
  ariaDescribedBy
}: TabbedNotesEditorProps) {
  const [tab, setTab] = useState<Tab>(
    defaultTab ?? (value.trim() ? 'preview' : 'edit')
  )

  return (
    <RadixTabs
      value={tab}
      onValueChange={(next) => {
        if (!disabled) setTab(next as Tab)
      }}
      className={clsx(
        'w-full min-w-0 max-w-full overflow-hidden rounded-md border border-(--card-border) bg-(--card-bg)',
        className
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-(--card-border) bg-(--card-bg) px-2 py-1">
        <RadixTabsList className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-1 border-0 bg-transparent p-0">
          <RadixTabsTrigger
            value="preview"
            disabled={disabled}
            className="min-h-[44px] min-w-[44px] rounded-sm px-3 py-2 text-xs data-[state=active]:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] data-[state=active]:text-(--accent)"
          >
            Preview
          </RadixTabsTrigger>
          <RadixTabsTrigger
            value="edit"
            disabled={disabled}
            className="min-h-[44px] min-w-[44px] rounded-sm px-3 py-2 text-xs data-[state=active]:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] data-[state=active]:text-(--accent)"
          >
            Edit
          </RadixTabsTrigger>
        </RadixTabsList>
        {caption && (
          // `min-w-0` lets truncate work in the flex row; hidden on narrow screens.
          <span className="hidden min-w-0 truncate text-xs italic text-[color-mix(in_srgb,var(--text-secondary)_70%,transparent)] sm:inline">
            {caption}
          </span>
        )}
      </div>

      <div className="p-3">
        <RadixTabsContent value="preview" className="m-0 focus-visible:ring-0">
          {value.trim() ? (
            <div className="prose prose-invert prose-sm max-w-none wrap-break-word text-primary-wh40k prose-headings:text-primary-wh40k prose-strong:text-primary-wh40k prose-li:my-0.5 prose-a:break-all">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-sm text-[color-mix(in_srgb,var(--text-secondary)_70%,transparent)] italic">
              No notes yet.
            </div>
          )}
        </RadixTabsContent>
        <RadixTabsContent value="edit" className="m-0 focus-visible:ring-0">
          <textarea
            value={value}
            onChange={(e) => {
              if (!disabled) onChange(e.target.value)
            }}
            placeholder={placeholder}
            rows={rows}
            disabled={disabled}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            className="w-full min-w-0 resize-y rounded-md bg-transparent p-2 font-mono text-sm text-primary-wh40k placeholder-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--accent)"
          />
        </RadixTabsContent>
      </div>
    </RadixTabs>
  )
}
