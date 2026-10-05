export function DesktopWorkspaceBar() {
  return (
    <aside
      aria-label="Local desktop workspace"
      className="border-b border-(--card-border) bg-(--card-bg) px-4 py-3 text-sm text-(--text-secondary)"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
        <p>
          <strong className="text-(--text-primary)">
            Local desktop preview
          </strong>
          <span className="ml-2">
            Game connection is unavailable in this preview.
          </span>
        </p>
        <nav aria-label="Local workspace actions" className="flex gap-4">
          <a href="/desktop/import" className="text-(--primary) underline">
            Import raid file
          </a>
          <a href="/desktop/setup" className="text-(--primary) underline">
            Manage workspace
          </a>
        </nav>
      </div>
    </aside>
  )
}
