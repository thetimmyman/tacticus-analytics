interface BossAssignmentsReadOnlyBannerProps {
  canEdit: boolean
}

export function BossAssignmentsReadOnlyBanner({
  canEdit
}: BossAssignmentsReadOnlyBannerProps) {
  if (canEdit) return null

  return (
    <div
      role="note"
      aria-label="Read-only assignment access"
      className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-4 py-3 text-sm text-[var(--text-secondary)]"
    >
      <span className="font-semibold text-[var(--text-primary)]">
        Read-only view.
      </span>{' '}
      Assignments are managed by your guild&apos;s officers and leaders — ask
      them for changes.
    </div>
  )
}
