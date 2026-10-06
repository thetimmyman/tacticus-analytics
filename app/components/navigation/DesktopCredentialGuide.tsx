export function DesktopCredentialGuide() {
  return (
    <div className="card-wh40k p-6" role="note">
      <h2 className="text-xl font-semibold mb-2">Tacticus API access</h2>
      <p>
        Open{' '}
        <a href="/desktop/connect" className="underline">
          API access and sync
        </a>{' '}
        to sync saved access, replace a key or add access in a secure native
        dialog. Player access enables your roster; Guild and Guild Raid access
        unlock guild features. Your workspace opens automatically on this
        device.
      </p>
      <p className="mt-2 text-secondary-wh40k">
        This preview supports manual current-raid and roster sync. Saved rosters
        remain available offline after restart or key removal. Your local player
        identity remains unverified.
      </p>
    </div>
  )
}
