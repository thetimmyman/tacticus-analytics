'use client'

import { useState } from 'react'

export function TargetNotes({
  name,
  notes,
  canEdit,
  onSave
}: {
  name: string
  notes: string | null
  canEdit: boolean
  onSave: (notes: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!editing || !canEdit)
    return (
      <div className="mt-1 text-xs text-secondary-wh40k">
        {notes && <p className="whitespace-pre-wrap">{notes}</p>}
        {canEdit && (
          <button
            type="button"
            aria-label={`Edit target notes for ${name}`}
            data-testid="targets-mutation-control"
            className="underline"
            onClick={() => {
              setDraft(notes ?? '')
              setError(null)
              setEditing(true)
            }}
          >
            {notes ? 'Edit note' : 'Add note'}
          </button>
        )}
      </div>
    )
  return (
    <form
      className="mt-1 space-y-1"
      onSubmit={async (event) => {
        event.preventDefault()
        if (saving) return
        setSaving(true)
        setError(null)
        try {
          await onSave(draft)
          setEditing(false)
        } catch (failure) {
          setError(
            failure instanceof Error ? failure.message : 'Failed to save note'
          )
        } finally {
          setSaving(false)
        }
      }}
    >
      <textarea
        aria-label={`Target notes for ${name}`}
        maxLength={500}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        className="w-full rounded border border-(--card-border) bg-(--bg-primary) p-2 text-primary-wh40k"
      />
      <button type="submit" disabled={saving} className="mr-2 underline">
        Save target notes
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => setEditing(false)}
        className="underline"
      >
        Cancel note edit
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
