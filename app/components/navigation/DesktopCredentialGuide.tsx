export function DesktopCredentialGuide() {
  return (
    <div className="card-wh40k p-6" role="note">
      <h2 className="text-xl font-semibold mb-2">Tacticus API access</h2>
      <p>
        Open{' '}
        <a href="/desktop/connect" className="underline">
          API access and sync
        </a>{' '}
        to connect your Player key in a secure native dialog. Add Guild and
        Guild Raid access to unlock guild features. Unlock your workspace once;
        adding or syncing keys uses that session.
      </p>
      <p className="mt-2 text-secondary-wh40k">
        This preview supports manual current-raid and roster sync. Saved rosters
        remain available offline after restart or key removal. Your local player
        identity remains unverified.
      </p>
    </div>
  )
}
